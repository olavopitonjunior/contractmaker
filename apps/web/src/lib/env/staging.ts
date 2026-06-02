import { prisma } from "@/lib/db/prisma";

// Flag binária — ligada via env var STAGING_MODE=true no projeto Vercel staging.
// Compute-once: lida no boot da função serverless, não muda em runtime.
export const STAGING_MODE = process.env.STAGING_MODE === "true";

// Vercel propaga VERCEL_ENV automaticamente: "production" | "preview" | "development".
// "production" do projeto staging ainda é production deploy do ponto de vista do Vercel.
export const VERCEL_ENV = process.env.VERCEL_ENV;

export const ENV_LABEL = STAGING_MODE ? "STAGING" : "PROD";

/**
 * Allowlist default de crons que podem rodar em staging (apenas DB-only,
 * sem custo externo). Crons sensíveis (Asaas transfer, certidões portal,
 * cobrança recorrente) ficam OFF e só ligam via UI runtime.
 *
 * Em prod (STAGING_MODE=false) a função sempre retorna true.
 */
const DEFAULT_STAGING_CRON_ALLOWLIST = new Set<string>([
  "/api/cron/ocr-queue",
  "/api/cron/intents/expire",
  "/api/cron/drafts/cleanup",
  "/api/cron/agent-runs/cleanup",
  "/api/cron/api-usage/cleanup",
]);

/**
 * Decide se um cron path pode executar agora.
 * - Em prod: sempre true.
 * - Em staging: consulta `CronToggle` no DB; se não houver entry, usa o
 *   default allowlist. Fail-safe: erro no DB → recusa execução.
 */
export async function isCronAllowedInStaging(path: string): Promise<boolean> {
  if (!STAGING_MODE) return true;
  try {
    const toggle = await prisma.cronToggle.findUnique({ where: { path } });
    if (toggle) return toggle.enabled;
  } catch {
    return false;
  }
  return DEFAULT_STAGING_CRON_ALLOWLIST.has(path);
}

/**
 * Mascara PII em staging. No-op em prod.
 * - cpf: mantém os 2 últimos dígitos (`***.***.***-12`).
 * - email: mantém o 1º caractere + domínio (`u***@example.com`).
 * - phone: mantém os 4 últimos dígitos.
 */
export function maskInStaging(
  value: string | null | undefined,
  kind: "cpf" | "email" | "phone"
): string {
  if (!STAGING_MODE || !value) return value ?? "";
  if (kind === "cpf") return value.replace(/\d(?=\d{2})/g, "*");
  if (kind === "email") return value.replace(/(.).+(@)/, "$1***$2");
  if (kind === "phone") return value.replace(/\d(?=\d{4})/g, "*");
  return value;
}

/**
 * Prefixo pra chaves Redis (rate-limit, insights-cache) quando ambientes
 * compartilham instância. Em staging: "staging:" (configurável).
 */
export const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "";

export function prefixedRedisKey(key: string): string {
  return REDIS_KEY_PREFIX ? `${REDIS_KEY_PREFIX}${key}` : key;
}
