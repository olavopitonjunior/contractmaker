/**
 * Ciclo de vida de um job de certidão para fins de TRAVA e RETRY.
 *
 * Motivação (2026-06-05): a trava de "extração em andamento" era por DEAL
 * INTEIRO — qualquer job `pending`/`fetching` recusava todo novo disparo (409),
 * travando o usuário (ex.: TJSP não disparava porque uma TRF3 ainda processava).
 * A regra correta é POR ALVO (endpoint+parte): só está bloqueado o alvo que
 * está genuinamente em andamento; erros (sem saldo, instabilidade, divergência)
 * são retentáveis na hora.
 *
 * Estes helpers são compartilhados entre o backend (route de disparo) e a UI
 * (lock de checkbox no diálogo, seleção do "Retentar erros"). O tipo de entrada
 * é estrutural para aceitar tanto o `CertidaoJob` do Prisma quanto a row da UI.
 */

export interface LifecycleJob {
  status: string;
  retryCount?: number | null;
  maxRetries?: number | null;
  createdAt?: Date | string | number | null;
  attachmentId?: string | null;
  /** JSON da resposta; lemos `numero_pedido` para distinguir awaiting saudável de zumbi. */
  resultData?: unknown;
}

/** Janela além da qual um job preso em pending/fetching é "travado" (não bloqueia). */
export const STALE_DISPATCH_MS = 30 * 60_000;

function readNumeroPedido(resultData: unknown): string | null {
  if (!resultData || typeof resultData !== "object") return null;
  const v = (resultData as Record<string, unknown>).numero_pedido;
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * O alvo está GENUINAMENTE em andamento → bloqueia um novo disparo do MESMO
 * alvo (evita pedido/cobrança em duplicidade). Casos:
 *   - `pending`/`fetching` recente (< 30 min): despacho ativo. Mais velho que
 *     isso é "travado" (lambda reciclado) e NÃO bloqueia — o sweeper/recuperar
 *     travadas trata.
 *   - `awaiting_portal` SAUDÁVEL: tem `numero_pedido` (o portal aceitou o pedido
 *     e o cron vai buscar o PDF). Zumbi de awaiting_portal (sem protocolo —
 *     pedido nunca validou) NÃO bloqueia, vira retentável.
 * Qualquer estado terminal (success, informativo, failed, failed_permanent,
 * data_missing, data_invalid, skipped, replaced, duplicate_pending) NÃO bloqueia.
 */
export function isInProgressBlocking(
  job: LifecycleJob,
  nowMs: number = Date.now()
): boolean {
  const s = job.status;
  if (s === "pending" || s === "fetching") {
    const created = job.createdAt != null ? new Date(job.createdAt).getTime() : nowMs;
    if (Number.isNaN(created)) return true;
    return nowMs - created < STALE_DISPATCH_MS;
  }
  if (s === "awaiting_portal") {
    return readNumeroPedido(job.resultData) !== null;
  }
  return false;
}

/** Estados terminais que o usuário pode RE-DISPARAR (erro de verdade). */
const RETRYABLE_ERROR_STATUSES = new Set<string>([
  "failed",
  "failed_permanent",
  "data_missing",
  "data_invalid",
  // transitórios já em auto-retry pelo cron — mas o usuário pode forçar agora
  // (instabilidade/limite). Pedido do produto: "se houve erro/instabilidade, o
  // usuário deve poder tentar de novo".
  "portal_unavailable",
  "rate_limited",
  "api_error",
]);

/**
 * O alvo está num estado de ERRO que vale re-disparar. Inclui sucesso sem PDF
 * (re-baixar). NÃO inclui o que está em andamento (isInProgressBlocking),
 * sucesso com anexo, informativo, skipped (fora de escopo) nem replaced.
 */
export function isRetryableError(
  job: LifecycleJob,
  nowMs: number = Date.now()
): boolean {
  if (isInProgressBlocking(job, nowMs)) return false;
  if (RETRYABLE_ERROR_STATUSES.has(job.status)) return true;
  // sucesso que não anexou PDF — re-baixar/re-emitir
  if (job.status === "success" && !job.attachmentId) return true;
  return false;
}

/** Rótulo curto para o motivo de um alvo bloqueado (UI). */
export function blockedReasonLabel(job: LifecycleJob): string {
  if (job.status === "awaiting_portal") return "Aguardando o tribunal";
  return "Em andamento";
}
