import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { createChallenge, ChallengeKind } from "@/lib/security/challenge";
import { sendEmail } from "@/lib/email/client";
import { OtpChallengeEmail } from "@/lib/email/templates/otp-challenge";
import { audit } from "@/lib/security/audit";
import { RateLimits } from "@/lib/security/ratelimit";
import { maskEmail } from "@/lib/security/pii";

const KINDS = [
  "TRANSFER",
  "BANK_ACCOUNT_CHANGE",
  "SUBACCOUNT_DELETE",
  "DUAL_APPROVE",
  "FEES_CHANGE",
] as const satisfies readonly ChallengeKind[];

const bodySchema = z.object({
  kind: z.enum(KINDS),
  payloadHash: z.string().min(32),
});

const KIND_LABELS: Record<ChallengeKind, string> = {
  TRANSFER: "Transferência",
  BANK_ACCOUNT_CHANGE: "Alteração de dados bancários",
  SUBACCOUNT_DELETE: "Exclusão de subconta",
  DUAL_APPROVE: "Aprovação dupla",
  FEES_CHANGE: "Alteração de taxas",
};

/**
 * POST /api/security/challenges
 * Cria desafio OTP 6-dígitos enviado por email, bound a payloadHash.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const rl = await RateLimits.challengesPerUser(ctx.userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas requisições. Aguarde alguns segundos.", retryAfter: rl.reset },
      { status: 429 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { id, code, expiresAt } = await createChallenge({
    userId: ctx.userId,
    orgId: ctx.orgId,
    kind: parsed.data.kind,
    payloadHash: parsed.data.payloadHash,
    ip: ctx.ipAddress,
    ua: ctx.userAgent,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "CHALLENGE_CREATED",
      result: "SUCCESS",
      metadata: { kind: parsed.data.kind, challengeId: id },
    }
  );

  // Send email async — mas await para garantir envio antes de responder
  await sendEmail({
    to: ctx.userEmail,
    subject: `Código de confirmação: ${KIND_LABELS[parsed.data.kind]}`,
    react: OtpChallengeEmail({
      userName: ctx.userName,
      code,
      operation: KIND_LABELS[parsed.data.kind],
      expiresInMinutes: 5,
    }) as any,
  });

  return NextResponse.json({
    id,
    expiresAt,
    sentTo: maskEmail(ctx.userEmail),
  });
}
