import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Health check público (sem auth) pra uptime monitor externo. Retorna shape
 * estável: { status, env, asaasEnv, dbConnected, redisConnected, version }.
 *
 * `status` é "ok" se DB conectou; "degraded" senão. Sempre 200 — o consumer
 * decide o que considerar fail (geralmente assert status==="ok").
 */
export async function GET() {
  const startedAt = Date.now();
  let dbConnected = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await prisma.$queryRawUnsafe("SELECT 1");
    dbLatencyMs = Date.now() - t0;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  let redisConnected = false;
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const { Redis } = await import("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      await redis.ping();
      redisConnected = true;
    }
  } catch {
    redisConnected = false;
  }

  return NextResponse.json({
    status: dbConnected ? "ok" : "degraded",
    env: process.env.STAGING_MODE === "true" ? "staging" : "production",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    asaasEnv: process.env.ASAAS_ENV ?? "production",
    dbConnected,
    dbLatencyMs,
    redisConnected,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    rootDomain: process.env.ROOT_DOMAIN ?? "imobpro.ia.br",
    totalLatencyMs: Date.now() - startedAt,
  });
}
