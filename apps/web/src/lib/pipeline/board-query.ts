import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DealCard } from "@/components/pipeline/KanbanCard";
import { DEAL_CARD_INCLUDE, toDealCard } from "@/lib/pipeline/deal-dates";
import {
  boardFiltersWhere,
  type PipelineBoardFilters,
} from "@/lib/pipeline/list-filters";

/**
 * Query única do board do kanban (plano 2026-08-06, PR 3.4). Motivações:
 *  - CAP de deals por coluna: org com anos de histórico carregava TODOS os
 *    deals no server render. `take: 200` por stage + `_count` filtrado dão
 *    "mostrando N de M" honesto (sem cap silencioso);
 *  - filtros server-side (list-filters.ts) entram no WHERE — a busca enxerga
 *    o que ficou fora da página;
 *  - KPIs da ORG (getBoardKpis) saem de aggregate/groupBy, não dos cards
 *    carregados — com o cap, contar cards mentiria.
 */

export const BOARD_TAKE_PER_STAGE = 200;

export interface BoardStage {
  id: string;
  name: string;
  color: string | null;
  /** Total de deals do stage que casam com o filtro (não só os carregados). */
  total: number;
  deals: DealCard[];
}

export interface BoardData {
  pipelineId: string;
  stages: BoardStage[];
  /** Totais pós-filtro: matching = _count somado; loaded = cards no payload. */
  totals: { matching: number; loaded: number };
}

export async function getBoardStages(params: {
  orgId: string;
  kind: "venda" | "locacao";
  filters: PipelineBoardFilters;
  /** Escopo extra (RBAC dealScopeWhere, kind do deal em locação…). */
  extraWhere?: Prisma.DealWhereInput;
  /** Ordem dos cards na coluna — venda: position asc; locação: createdAt desc. */
  orderBy: Prisma.DealOrderByWithRelationInput;
  nowMs: number;
}): Promise<BoardData | null> {
  const { orgId, kind, filters, extraWhere, orderBy, nowMs } = params;
  const dealWhere: Prisma.DealWhereInput = {
    ...boardFiltersWhere(filters, new Date(nowMs)),
    ...(extraWhere ?? {}),
  };

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId, kind },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            where: dealWhere,
            orderBy,
            take: BOARD_TAKE_PER_STAGE,
            include: DEAL_CARD_INCLUDE,
          },
          _count: { select: { deals: { where: dealWhere } } },
        },
      },
    },
  });
  if (!pipeline) return null;

  const stages: BoardStage[] = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    total: stage._count.deals,
    deals: stage.deals.map((deal) => toDealCard(deal, nowMs, stage.name)),
  }));

  return {
    pipelineId: pipeline.id,
    stages,
    totals: {
      matching: stages.reduce((sum, s) => sum + s.total, 0),
      loaded: stages.reduce((sum, s) => sum + s.deals.length, 0),
    },
  };
}

export interface BoardKpis {
  totalDeals: number;
  totalValue: number;
  dealsToday: number;
  dealsWithValue: number;
  /** count/sum por stageId — o caller cruza com os nomes que já tem. */
  byStageId: Record<string, { count: number; value: number }>;
}

/**
 * KPIs da org via aggregate — INDEPENDEM dos filtros da URL (mostram o todo)
 * e do cap por coluna. `baseWhere` deve trazer pipelineId + escopo RBAC +
 * archivedAt (mesma visão default do board sem filtros).
 */
export async function getBoardKpis(
  baseWhere: Prisma.DealWhereInput,
  startOfToday: Date
): Promise<BoardKpis> {
  const [byStage, withValue, today] = await Promise.all([
    prisma.deal.groupBy({
      by: ["stageId"],
      where: baseWhere,
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.deal.count({ where: { ...baseWhere, value: { gt: 0 } } }),
    prisma.deal.count({ where: { ...baseWhere, createdAt: { gte: startOfToday } } }),
  ]);

  const byStageId: BoardKpis["byStageId"] = {};
  let totalDeals = 0;
  let totalValue = 0;
  for (const row of byStage) {
    const count = row._count._all;
    const value = row._sum.value ?? 0;
    byStageId[row.stageId] = { count, value };
    totalDeals += count;
    totalValue += value;
  }

  return { totalDeals, totalValue, dealsToday: today, dealsWithValue: withValue, byStageId };
}
