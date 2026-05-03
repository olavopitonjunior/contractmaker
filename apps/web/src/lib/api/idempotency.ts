import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * Idempotência por (userId, key) para chamadas POST/PATCH/DELETE de clientes
 * externos. Cliente envia `X-Idempotency-Key: <uuid>` por intenção (não por
 * retry). Servidor garante que mesma key dentro de 24h retorna mesma resposta.
 *
 * Uso típico em handler:
 *   const key = req.headers.get("x-idempotency-key");
 *   if (key) {
 *     const cached = await getCachedResponse(userId, key);
 *     if (cached) return new Response(JSON.stringify(cached.body), { status: cached.status });
 *   }
 *   ... executar operação ...
 *   if (key) await persistResponse(userId, key, req.method, url.pathname, status, body);
 *
 * TTL: 24h. Limpeza via cron `cleanupIdempotencyKeys()`.
 */

export const IDEMPOTENCY_TTL_HOURS = 24;

export function hashResponseBody(body: unknown): string {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(str).digest("hex");
}

export interface CachedResponse {
  status: number;
  body: unknown;
  hash: string;
}

export async function getCachedResponse(
  userId: string,
  key: string
): Promise<CachedResponse | null> {
  const record = await prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: {
      statusCode: true,
      responseBody: true,
      responseHash: true,
      createdAt: true,
    },
  });
  if (!record) return null;

  // TTL guard: registro velho (>24h) é tratado como ausente. Cleanup cron
  // remove fisicamente; aqui só ignora.
  const ttlMs = IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000;
  if (Date.now() - record.createdAt.getTime() > ttlMs) {
    return null;
  }

  return {
    status: record.statusCode,
    body: record.responseBody,
    hash: record.responseHash,
  };
}

export async function persistResponse(args: {
  userId: string;
  key: string;
  method: string;
  path: string;
  status: number;
  body: unknown;
}): Promise<void> {
  const hash = hashResponseBody(args.body);
  await prisma.idempotencyKey.upsert({
    where: { userId_key: { userId: args.userId, key: args.key } },
    create: {
      userId: args.userId,
      key: args.key,
      method: args.method,
      path: args.path,
      statusCode: args.status,
      responseHash: hash,
      responseBody: args.body as object,
    },
    update: {
      // Race: dois requests simultâneos com mesma key — segundo upsert é no-op
      // (response do primeiro venceu).
    },
  });
}

/**
 * Remove keys com mais de 24h. Executar via cron diário.
 */
export async function cleanupIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(
    Date.now() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000
  );
  const result = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Helper de alto nível: envolve handler async garantindo que se key estiver
 * presente, response é cacheada. Caller faz suas próprias validações antes.
 *
 * Não cacheia 5xx (erros transientes — retry deve poder redo).
 */
export async function withIdempotency<T>(args: {
  userId: string;
  key: string | null;
  method: string;
  path: string;
  handler: () => Promise<{ status: number; body: T }>;
}): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!args.key) {
    const r = await args.handler();
    return { ...r, replayed: false };
  }
  const cached = await getCachedResponse(args.userId, args.key);
  if (cached) {
    return {
      status: cached.status,
      body: cached.body as T,
      replayed: true,
    };
  }
  const r = await args.handler();
  if (r.status < 500) {
    await persistResponse({
      userId: args.userId,
      key: args.key,
      method: args.method,
      path: args.path,
      status: r.status,
      body: r.body,
    });
  }
  return { ...r, replayed: false };
}
