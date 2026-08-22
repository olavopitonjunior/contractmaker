import type { Prisma } from "@prisma/client";
import { slaStatusWhere, type SlaStatus } from "@/lib/pipeline/sla";
import type { DealSourceChannel } from "@/lib/pipeline/source-channel";
import { DEAL_SOURCE_CHANNEL_LABEL } from "@/lib/pipeline/source-channel";

/**
 * Filtros SERVER-SIDE do kanban (plano 2026-08-06, PR 3.4) — URL é a fonte de
 * verdade (?q=&responsavel=&sla=&periodo=&canal=&arquivados=1). Diferente dos
 * filtros client do board (que só filtram os cards JÁ carregados), estes
 * entram no WHERE da query — obrigatório com o cap de 200 deals/stage, senão
 * a busca "não acha" um deal que existe mas ficou fora da página.
 *
 * Client-safe: parse/labels usados pelo PipelineFilters ("use client");
 * `boardFiltersWhere` só usa TIPO do Prisma.
 */

export const PERIODO_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type PeriodoFilter = keyof typeof PERIODO_DAYS;

export const PERIODO_LABEL: Record<PeriodoFilter, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
};

export const SLA_FILTER_LABEL: Record<SlaStatus, string> = {
  em_dia: "Em dia",
  atencao: "Atenção",
  atrasado: "Atrasado",
};

export interface PipelineBoardFilters {
  /** Busca em title + clientName (insensitive). */
  q: string | null;
  /**
   * Id do usuário no filtro "Responsável". Casa `Deal.userId` (criador) OU
   * `Deal.managerUserId` (gerente atribuído) — o card do kanban exibe o
   * GERENTE, então filtrar só pelo criador escondia o negócio de quem a tela
   * aponta como responsável.
   */
  responsavel: string | null;
  sla: SlaStatus | null;
  /** Janela de criação do deal. */
  periodo: PeriodoFilter | null;
  canal: DealSourceChannel | null;
  /** true = mostra também arquivados (default oculta). */
  arquivados: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

function oneOf<T extends string>(v: string | null, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseBoardFilters(sp: SearchParams | undefined): PipelineBoardFilters {
  return {
    q: str(sp?.q),
    responsavel: str(sp?.responsavel),
    sla: oneOf(str(sp?.sla), ["em_dia", "atencao", "atrasado"] as const),
    periodo: oneOf(str(sp?.periodo), ["7d", "30d", "90d"] as const),
    canal: oneOf(
      str(sp?.canal),
      Object.keys(DEAL_SOURCE_CHANNEL_LABEL) as DealSourceChannel[]
    ),
    arquivados: str(sp?.arquivados) === "1",
  };
}

/** Há filtro que restringe a QUERY (arquivados só amplia — fica de fora). */
export function hasActiveBoardFilters(f: PipelineBoardFilters): boolean {
  return !!(f.q || f.responsavel || f.sla || f.periodo || f.canal);
}

/** WHERE combinado dos filtros — mesclar com o escopo do caller (org/RBAC). */
export function boardFiltersWhere(
  f: PipelineBoardFilters,
  now: Date
): Prisma.DealWhereInput {
  const where: Prisma.DealWhereInput = {};
  // Filtros que precisam de OR entram em `AND` — dois `where.OR` no mesmo
  // objeto se sobrescrevem em silêncio (a busca some quando há responsável).
  const and: Prisma.DealWhereInput[] = [];
  if (!f.arquivados) where.archivedAt = null;
  if (f.q) {
    and.push({
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { clientName: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.responsavel) {
    and.push({
      OR: [{ userId: f.responsavel }, { managerUserId: f.responsavel }],
    });
  }
  if (f.canal) where.sourceChannel = f.canal;
  if (f.periodo) {
    where.createdAt = {
      gte: new Date(now.getTime() - PERIODO_DAYS[f.periodo] * 86_400_000),
    };
  }
  if (f.sla) Object.assign(where, slaStatusWhere(f.sla, now));
  if (and.length > 0) where.AND = and;
  return where;
}
