/**
 * Rate limiter com Upstash Redis como fonte primária e fallback in-memory.
 * - Em prod (Vercel serverless): SEMPRE exigir Upstash. Sem ele, logs warning + fallback.
 * - Fallback in-memory: válido por instância — NÃO é seguro em serverless (cold start reseta).
 *   Use só em dev local.
 */

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // epoch ms
}

type Window = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

interface RateLimitConfig {
  limit: number;
  window: Window;
  identifier: string;
}

function parseWindow(window: Window): number {
  const [nStr, unit] = window.split(" ");
  const n = parseInt(nStr, 10);
  switch (unit) {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: throw new Error(`Invalid window: ${window}`);
  }
}

// ---------- In-memory fallback ----------

interface BucketEntry {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, BucketEntry>();

function memoryLimit(cfg: RateLimitConfig): RateLimitResult {
  const windowMs = parseWindow(cfg.window);
  const now = Date.now();
  const key = `${cfg.identifier}`;
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, limit: cfg.limit, remaining: cfg.limit - 1, reset: now + windowMs };
  }

  if (existing.count >= cfg.limit) {
    return { success: false, limit: cfg.limit, remaining: 0, reset: existing.resetAt };
  }

  existing.count += 1;
  return {
    success: true,
    limit: cfg.limit,
    remaining: cfg.limit - existing.count,
    reset: existing.resetAt,
  };
}

// Periódico cleanup para evitar leak em long-running processes (dev server)
if (typeof globalThis !== "undefined" && !(globalThis as any).__rateLimitCleanup) {
  (globalThis as any).__rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryBuckets.entries()) {
      if (v.resetAt < now) memoryBuckets.delete(k);
    }
  }, 60_000);
}

// ---------- Upstash path ----------

let _upstashLimiters: Record<string, { limit: (id: string) => Promise<any> }> | null = null;

async function getUpstashLimiter(cfg: RateLimitConfig) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_upstashLimiters) _upstashLimiters = {};

  const key = `${cfg.limit}@${cfg.window}`;
  if (_upstashLimiters[key]) return _upstashLimiters[key];

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
      prefix: "cm-ratelimit",
    });
    _upstashLimiters[key] = limiter as any;
    return _upstashLimiters[key];
  } catch (err) {
    console.warn("[ratelimit] Upstash indisponível, usando fallback in-memory", err);
    return null;
  }
}

export async function rateLimit(cfg: RateLimitConfig): Promise<RateLimitResult> {
  const upstash = await getUpstashLimiter(cfg);
  if (upstash) {
    try {
      const r = await upstash.limit(cfg.identifier);
      return {
        success: r.success,
        limit: r.limit,
        remaining: r.remaining,
        reset: r.reset,
      };
    } catch (err) {
      console.warn("[ratelimit] Upstash error, falling back to memory", err);
    }
  }
  return memoryLimit(cfg);
}

// ---------- Helpers prontos ----------

export const RateLimits = {
  challengesPerUser: (userId: string) =>
    rateLimit({ identifier: `challenge:${userId}`, limit: 5, window: "1 m" }),
  elevationFailuresPerUser: (userId: string) =>
    rateLimit({ identifier: `elev-fail:${userId}`, limit: 3, window: "1 h" }),
  chargesPerOrg: (orgId: string) =>
    rateLimit({ identifier: `charge:${orgId}`, limit: 20, window: "1 h" }),
  transfersPerUser: (userId: string) =>
    rateLimit({ identifier: `transfer:${userId}`, limit: 5, window: "1 h" }),
  publicPageByIp: (ip: string) =>
    rateLimit({ identifier: `public:${ip}`, limit: 30, window: "1 m" }),
  publicResendByToken: (token: string) =>
    rateLimit({ identifier: `public-resend:${token}`, limit: 1, window: "1 h" }),
} as const;
