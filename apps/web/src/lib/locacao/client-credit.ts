// Helpers puros pra resumir a análise de crédito Serasa de um cliente a partir
// dos CertidaoJob (provider="serasa"). Sem I/O — recebe os jobs já carregados.
//
// Sem caller desde 2026-09-02, de propósito: o Serasa não está integrado e a
// listagem de clientes deixou de mostrar o selo. Mantido para religar quando a
// integração existir — sem caller e sem teste, então regressão aqui só aparece
// no dia do religamento.

export type SerasaTone = "pending" | "ok" | "bad" | "info";

export interface SerasaJobLike {
  status: string;
  resultData: unknown;
}

const PENDING = new Set([
  "pending",
  "fetching",
  "queued",
  "api_error",
  "rate_limited",
  "portal_unavailable",
]);

function situacaoOf(job: SerasaJobLike): string | null {
  const r = job.resultData as { situacao?: string } | null;
  return r?.situacao ?? null;
}

/**
 * Agrega N jobs (score + restritivos por pessoa) num único rótulo/tom pra badge.
 * Precedência: em andamento → com restrição → falha → sem restrição → informativa.
 */
export function summarizeSerasaJobs(
  jobs: SerasaJobLike[]
): { label: string | null; tone: SerasaTone | null } {
  if (jobs.length === 0) return { label: null, tone: null };
  if (jobs.some((j) => PENDING.has(j.status))) {
    return { label: "Consultando…", tone: "pending" };
  }
  if (jobs.some((j) => j.status === "success" && situacaoOf(j) === "com_restricao")) {
    return { label: "Com restrição", tone: "bad" };
  }
  if (jobs.some((j) => j.status === "failed" || j.status === "failed_permanent")) {
    return { label: "Falha na consulta", tone: "bad" };
  }
  if (jobs.some((j) => j.status === "success" && situacaoOf(j) === "sem_restricao")) {
    return { label: "Sem restrição", tone: "ok" };
  }
  return { label: "Informativa", tone: "info" };
}
