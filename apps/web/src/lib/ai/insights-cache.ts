// Cache simples pra insights — Upstash Redis se disponível, fallback in-memory.
// TTL 30min. Key formato: insights:${context}:${id}:${hash}.

import crypto from "crypto";

interface InsightCacheEntry {
  insights: AIInsight[];
  cachedAt: number;
}

export interface AIInsight {
  severity: "info" | "alert" | "suggestion";
  title: string;
  detail?: string;
}

const TTL_MS = 30 * 60 * 1000;
// Timeout curto para chamadas Redis: o Upstash usa fetch sem timeout, então um
// endpoint inacessível (ex.: staging com redisConnected:false) penduraria a
// request inteira. Com o race, cache indisponível vira cache-miss/no-op.
const REDIS_TIMEOUT_MS = 2000;
const memCache = new Map<string, InsightCacheEntry>();

/** Resolve `null` (timeout) em vez de pendurar quando o Redis não responde. */
function withTimeout<T>(p: Promise<T>): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), REDIS_TIMEOUT_MS)),
  ]);
}

let _redis: { get: (k: string) => Promise<string | null>; set: (k: string, v: string, opts: { ex: number }) => Promise<unknown> } | null | undefined;

async function getRedis() {
  if (_redis !== undefined) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }) as unknown as typeof _redis;
    return _redis;
  } catch {
    _redis = null;
    return null;
  }
}

export function hashSnapshot(snapshot: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 16);
}

export function cacheKey(context: string, id: string, hash: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}insights:${context}:${id}:${hash}`;
}

export async function getCached(key: string): Promise<AIInsight[] | null> {
  // Memória primeiro (mais rápido em mesma instância).
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.cachedAt < TTL_MS) {
    return mem.insights;
  }

  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await withTimeout(redis.get(key));
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed as AIInsight[];
  } catch {
    return null;
  }
}

export async function setCached(key: string, insights: AIInsight[]): Promise<void> {
  memCache.set(key, { insights, cachedAt: Date.now() });
  const redis = await getRedis();
  if (!redis) return;
  try {
    await withTimeout(redis.set(key, JSON.stringify(insights), { ex: Math.floor(TTL_MS / 1000) }));
  } catch {
    // silent
  }
}
