import type { Prisma } from "@prisma/client";

/**
 * Status de SLA do deal (plano 2026-08-06, PR 3.3), derivado dos deadlines
 * MATERIALIZADOS `Deal.slaWarnAt`/`slaDueAt` (escritos pelo moveDealStage com
 * a política congelada na entrada do stage; backfill 20260806180000 cobre o
 * estoque). Client-safe: só import de TIPO do Prisma — este módulo é usado
 * tanto por Server Components (filtro) quanto pelo KanbanCard ("use client").
 *
 * Regra única (badge do card, filtro do board e cron DEVEM concordar):
 *   atrasado — slaDueAt  < now
 *   atencao  — slaWarnAt < now  E  slaDueAt >= now
 *   em_dia   — dentro do prazo
 *   null     — sem SLA (stage terminal, política desabilitada ou pré-backfill)
 */

export type SlaStatus = "atrasado" | "atencao" | "em_dia";

type DateLike = Date | string | null | undefined;

function toMs(d: DateLike): number | null {
  if (!d) return null;
  const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Função pura — `nowMs` vem do server (mesmo padrão do KanbanBoard, #418). */
export function slaStatusFrom(
  deal: { slaWarnAt: DateLike; slaDueAt: DateLike },
  nowMs: number
): SlaStatus | null {
  const warnMs = toMs(deal.slaWarnAt);
  const dueMs = toMs(deal.slaDueAt);
  if (warnMs === null && dueMs === null) return null;
  if (dueMs !== null && dueMs < nowMs) return "atrasado";
  if (warnMs !== null && warnMs < nowMs) return "atencao";
  return "em_dia";
}

/**
 * Condição Prisma equivalente pro filtro server-side (board/lista — PR 3.4).
 * Mantém paridade com `slaStatusFrom`: mudou lá, muda aqui.
 */
export function slaStatusWhere(status: SlaStatus, now: Date): Prisma.DealWhereInput {
  switch (status) {
    case "atrasado":
      return { slaDueAt: { lt: now } };
    case "atencao":
      return { slaWarnAt: { lt: now }, slaDueAt: { gte: now } };
    case "em_dia":
      // Dentro do prazo — deals sem SLA (null) ficam FORA de qualquer filtro
      // de status, igual ao `null` do slaStatusFrom.
      return { slaWarnAt: { gte: now } };
  }
}
