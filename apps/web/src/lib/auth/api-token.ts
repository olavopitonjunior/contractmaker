import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * API tokens para clientes externos autenticarem como um usuário (ex: agente
 * Newton via WhatsApp). Token cru `cmt_<base64url(32 bytes)>` é exibido uma
 * única vez na criação; servidor armazena apenas SHA-256 do token cru.
 *
 * Uso pelo cliente: header `Authorization: Bearer cmt_xxxxx`. Verificação em
 * `auth-or-bearer.ts`.
 */

const TOKEN_PREFIX = "cmt_";
const TOKEN_BYTES = 32;

export const API_TOKEN_SCOPES = [
  "deals:rw",
  "contracts:rw",
  "charges:rw",
  "signatures:rw",
  "documents:rw",
  "proposals:rw",
  // Locação (Max) — par por módulo; granularidade fina vem do RBAC do usuário
  // dono do token + entitlement do tenant + HITL. `locacao:rw ⊇ locacao:r`.
  "locacao:r",
  "locacao:rw",
  "metrics:r",
  // Newton — delegação Bearer via header X-Act-As-User (Fase A RBAC
  // hardening). Token com esse scope pode operar como qualquer user da
  // mesma org. Tratado em lib/auth/context.ts atrás de DELEGATION_ENABLED.
  "users:delegate",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function isValidScope(s: string): s is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(s);
}

/** Gera token cru. Não persiste — apenas retorna o valor para mostrar ao usuário. */
export function generateRawToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 do token cru. Lookup direto na tabela UserApiToken. */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface CreateTokenInput {
  userId: string;
  name: string;
  scopes: ApiTokenScope[];
  expiresAt?: Date | null;
}

export interface CreateTokenResult {
  /** Valor cru — exibir UMA vez ao usuário, não persistir em log/UI depois. */
  rawToken: string;
  token: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt: Date | null;
    createdAt: Date;
  };
}

export async function createApiToken(
  input: CreateTokenInput
): Promise<CreateTokenResult> {
  if (input.scopes.length === 0) {
    throw new Error("API token requires at least one scope");
  }
  for (const s of input.scopes) {
    if (!isValidScope(s)) {
      throw new Error(`Invalid scope: ${s}`);
    }
  }
  const rawToken = generateRawToken();
  const hashedToken = hashToken(rawToken);
  const created = await prisma.userApiToken.create({
    data: {
      userId: input.userId,
      name: input.name,
      hashedToken,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return { rawToken, token: created };
}

export async function revokeApiToken(
  tokenId: string,
  userId: string
): Promise<boolean> {
  const result = await prisma.userApiToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function listApiTokens(userId: string) {
  return prisma.userApiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export interface VerifiedToken {
  userId: string;
  tokenId: string;
  scopes: string[];
}

/**
 * Verifica Bearer token. Retorna `null` se inválido, expirado ou revogado.
 * Não loga falha aqui — caller decide se quer auditar.
 *
 * IMPORTANTE: lookup é por hash (SHA-256), não por timing-safe compare —
 * SHA-256 já é resistente a timing attacks via lookup direto pelo índice.
 */
export async function verifyBearerToken(
  rawToken: string
): Promise<VerifiedToken | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  const hashed = hashToken(rawToken);
  const record = await prisma.userApiToken.findUnique({
    where: { hashedToken: hashed },
    select: {
      id: true,
      userId: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // Best-effort: atualizar lastUsedAt (sem await — não bloqueia request).
  prisma.userApiToken
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* lastUsedAt é metric, não bloqueia auth */
    });

  return { userId: record.userId, tokenId: record.id, scopes: record.scopes };
}
