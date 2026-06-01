/**
 * Fase A (2026-06-01) — monitoramento de saúde das certidões.
 *
 * LÓGICA PURA (sem dependências do executor/prisma) para classificar cada job
 * em um "bucket" de saúde e montar relatórios. É consumida em dois lugares:
 *   - `executor.ts::runBatchHealthActions` (event-driven, ao fim de cada lote):
 *     auto-retry de falhas transitórias + notificação de dado-faltante.
 *   - `GET /api/admin/certidoes/health-report`: snapshot agregado sem PII.
 *
 * Mantida pura de propósito (testável + sem ciclo de import com executor).
 */
import { isEmailThrottle, isEndpointNotEnabled } from "./error-codes";

export type HealthBucket =
  | "ok" // success / informativo — nada a fazer
  | "em_voo" // transitório já sob retry do poll-portal (não agir)
  | "dado_faltante" // data_missing/data_invalid — operador precisa corrigir
  | "failed_retryable" // exceção transitória (timeout/portal) que virou `failed` terminal sem retry — re-armar
  | "credito" // 603 sem saldo / orçamento estourado
  | "config_endpoint" // 603 "consulta não habilitada" — ação de admin/dev
  | "codigo_suspeito" // integration_error ou failed inesperado — candidato a bug de código
  | "indisponivel" // portal esgotou tentativas — extração manual (tem portalUrl)
  | "outro";

export interface HealthJobLike {
  status: string;
  resultCode: number | null;
  errorMessage: string | null;
  resultData: unknown;
  retryCount: number | null;
}

const EM_VOO = new Set([
  "queued",
  "pending",
  "fetching",
  "api_error",
  "portal_unavailable",
  "rate_limited",
  "awaiting_portal",
  "duplicate_pending",
]);

function failureCategoryOf(job: HealthJobLike): string | null {
  const rd = job.resultData as { failureCategory?: string } | null;
  return rd?.failureCategory ?? null;
}

/**
 * Classifica UM job no bucket de saúde. Determinístico, sem efeitos.
 */
export function classifyJobBucket(job: HealthJobLike): HealthBucket {
  const { status } = job;
  if (status === "success" || status === "informativo") return "ok";
  if (status === "skipped" || status === "replaced") return "ok"; // não acionável aqui
  if (EM_VOO.has(status)) return "em_voo";
  if (status === "data_missing" || status === "data_invalid") return "dado_faltante";

  const msg = job.errorMessage ?? "";

  if (status === "failed") {
    const cat = failureCategoryOf(job);
    if (cat === "provider_timeout" || cat === "portal_unavailable") {
      return "failed_retryable";
    }
    if (cat === "integration_error") return "codigo_suspeito";
    return "outro";
  }

  if (status === "failed_permanent") {
    if (job.resultCode === 603 && isEndpointNotEnabled(msg)) return "config_endpoint";
    if (
      job.resultCode === 603 ||
      /sem saldo|cr[ée]dito|or[çc]amento/i.test(msg)
    ) {
      return "credito";
    }
    if (job.resultCode === 604 && isEmailThrottle(msg)) return "indisponivel"; // throttle esgotou os 5 retries
    if (
      job.resultCode != null &&
      [606, 608, 612, 613, 614].includes(job.resultCode)
    ) {
      return "dado_faltante";
    }
    if (/url inv[aá]lida|endpoint|integra[çc][aã]o/i.test(msg)) return "codigo_suspeito";
    return "indisponivel";
  }

  return "outro";
}

/**
 * Buckets que pedem ação automática segura.
 */
export const ACTIONABLE_RETRY: HealthBucket = "failed_retryable";
export const ACTIONABLE_NOTIFY: HealthBucket = "dado_faltante";

/**
 * Extrai um rótulo amigável do que falta corrigir num job de dado-faltante.
 * Usa `missingFields` quando disponível; senão a mensagem.
 */
export function missingFieldHint(
  job: HealthJobLike & { missingFields?: string[] | null; label?: string }
): string {
  const fields = (job.missingFields ?? []).filter(Boolean);
  if (fields.length > 0) return fields.join(", ");
  const msg = job.errorMessage ?? "";
  if (/nome.*m[aã]e|m[aã]e/i.test(msg)) return "nome da mãe";
  if (/nascimento|birthdate/i.test(msg)) return "data de nascimento";
  if (/cpf/i.test(msg)) return "CPF";
  if (/g[êe]nero|sexo/i.test(msg)) return "sexo";
  return "dados da parte";
}

export interface HealthReportRow {
  bucket: HealthBucket;
  count: number;
}

/**
 * Agrega uma lista de jobs em contagem por bucket + amostras (sem PII).
 * Usado pelo endpoint admin e pelo digest.
 */
export function buildHealthReport(jobs: HealthJobLike[]): {
  total: number;
  byBucket: HealthReportRow[];
  actionable: { retryable: number; dataMissing: number; codeSuspect: number };
} {
  const counts = new Map<HealthBucket, number>();
  for (const j of jobs) {
    const b = classifyJobBucket(j);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const byBucket: HealthReportRow[] = [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: jobs.length,
    byBucket,
    actionable: {
      retryable: counts.get("failed_retryable") ?? 0,
      dataMissing: counts.get("dado_faltante") ?? 0,
      codeSuspect: counts.get("codigo_suspeito") ?? 0,
    },
  };
}
