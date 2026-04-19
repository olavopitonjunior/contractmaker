import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "./crypto";

export type ChallengeKind =
  | "TRANSFER"
  | "BANK_ACCOUNT_CHANGE"
  | "SUBACCOUNT_DELETE"
  | "DUAL_APPROVE"
  | "FEES_CHANGE";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5min
const TOKEN_TTL_SECONDS = 90;

function getSecret(): Uint8Array {
  const raw = process.env.CHALLENGE_TOKEN_SECRET;
  if (!raw) throw new Error("CHALLENGE_TOKEN_SECRET ausente");
  return new TextEncoder().encode(raw);
}

function generateOtpCode(): string {
  // 6 dígitos, zero-padded
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload, Object.keys(payload as object).sort());
  return sha256Hex(json);
}

export async function createChallenge(params: {
  userId: string;
  orgId: string;
  kind: ChallengeKind;
  payloadHash: string;
  ip?: string | null;
  ua?: string | null;
}): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  const challenge = await prisma.operationChallenge.create({
    data: {
      userId: params.userId,
      orgId: params.orgId,
      kind: params.kind,
      payloadHash: params.payloadHash,
      channel: "EMAIL",
      codeHash,
      expiresAt,
      ipAddress: params.ip ?? null,
      userAgent: params.ua ? params.ua.slice(0, 1000) : null,
    },
  });

  return { id: challenge.id, code, expiresAt };
}

export type ChallengeVerificationResult =
  | { ok: true; token: string }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "CONSUMED" | "MAX_ATTEMPTS" | "WRONG_CODE" };

export async function confirmChallenge(params: {
  id: string;
  userId: string;
  code: string;
}): Promise<ChallengeVerificationResult> {
  const challenge = await prisma.operationChallenge.findUnique({
    where: { id: params.id },
  });

  if (!challenge) return { ok: false, reason: "NOT_FOUND" };
  if (challenge.userId !== params.userId) return { ok: false, reason: "NOT_FOUND" };
  if (challenge.consumedAt || challenge.cancelledAt) return { ok: false, reason: "CONSUMED" };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: "EXPIRED" };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: "MAX_ATTEMPTS" };

  const cleaned = params.code.replace(/\s/g, "");
  const matches = await bcrypt.compare(cleaned, challenge.codeHash);

  if (!matches) {
    await prisma.operationChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        // Se alcançar max, cancela
        cancelledAt: challenge.attempts + 1 >= challenge.maxAttempts ? new Date() : null,
      },
    });
    return { ok: false, reason: "WRONG_CODE" };
  }

  await prisma.operationChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  // Emite challenge-token JWT bound a payloadHash + challenge id.
  const token = await new SignJWT({
    chId: challenge.id,
    uid: challenge.userId,
    kind: challenge.kind,
    payloadHash: challenge.payloadHash,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS)
    .sign(getSecret());

  return { ok: true, token };
}

export async function cancelChallenge(id: string, userId: string): Promise<void> {
  await prisma.operationChallenge.updateMany({
    where: { id, userId, consumedAt: null, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });
}

export interface ChallengeTokenPayload {
  chId: string;
  uid: string;
  kind: ChallengeKind;
  payloadHash: string;
}

/**
 * Valida o X-Challenge-Token header e confirma que o payloadHash bate.
 * Usado no handler da operação (ex: POST /api/financeiro/transfers).
 */
export async function validateChallengeToken(
  token: string,
  expected: { userId: string; kind: ChallengeKind; payloadHash: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const p = payload as unknown as ChallengeTokenPayload;
    if (p.uid !== expected.userId) return { ok: false, reason: "USER_MISMATCH" };
    if (p.kind !== expected.kind) return { ok: false, reason: "KIND_MISMATCH" };
    if (p.payloadHash !== expected.payloadHash) return { ok: false, reason: "PAYLOAD_TAMPERED" };
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    return { ok: false, reason: msg.includes("expired") ? "TOKEN_EXPIRED" : "TOKEN_INVALID" };
  }
}
