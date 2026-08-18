import type { Prisma } from "@prisma/client";
import type { DealCard } from "@/components/pipeline/KanbanCard";
import {
  AGING_WARN_DAYS,
  AGING_DANGER_DAYS,
  daysInStage,
  isTerminalStageName,
} from "@/lib/pipeline/stage-config";
import { slaStatusFrom, type SlaStatus } from "@/lib/pipeline/sla";

/**
 * Datas-marco do deal — FONTE ÚNICA (plano 2026-08-06, PR 3.3). A derivação
 * "envelope fechado ?? scalar do Deal" vivia copiada em 4 lugares (pipeline
 * venda/locação, DealDetail, LocacaoDealDetail) e qualquer mudança na regra
 * exigia 4 edits sincronizados. Client-safe: só imports de TIPO do Prisma —
 * DealDetail ("use client") também consome.
 */

/** Include mínimo pros marcos — mesclar no include do caller. */
export const DEAL_MILESTONE_INCLUDE = {
  envelopes: {
    where: {
      source: "contract",
      status: "closed",
      contract: { kind: "contract" },
    },
    select: { closedAt: true },
    orderBy: { closedAt: "desc" },
    take: 1,
  },
  commissionCharges: {
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  },
} satisfies Prisma.DealInclude;

/** Include completo do card do kanban (marcos + form + contrato + gerente). */
export const DEAL_CARD_INCLUDE = {
  ...DEAL_MILESTONE_INCLUDE,
  // NÃO selecionar form.dataJson aqui: é o payload inteiro do formulário por
  // deal só pra derivar um nome — o nome vive denormalizado em Deal.clientName.
  form: {
    select: {
      id: true,
      status: true,
      token: true,
      createdAt: true,
      completedAt: true,
    },
  },
  contracts: {
    where: { isLatest: true, kind: "contract" },
    select: { id: true, version: true },
  },
  // Gerente responsável — nome no card do kanban.
  manager: { select: { name: true, email: true } },
} satisfies Prisma.DealInclude;

export type DealForCard = Prisma.DealGetPayload<{ include: typeof DEAL_CARD_INCLUDE }>;

type DateLike = Date | string | null | undefined;

/** Shape estrutural — aceita tanto o payload Prisma (Date) quanto DTO (string). */
export interface DealMilestoneSource {
  contractSignedAt?: DateLike;
  chargeIssuedAt?: DateLike;
  commissionPaidAt?: DateLike;
  form?: { createdAt?: DateLike; completedAt?: DateLike } | null;
  envelopes: Array<{ closedAt: DateLike }>;
  commissionCharges: Array<{ createdAt: DateLike }>;
}

export interface DealMilestones {
  formOpenedAt: DateLike;
  formCompletedAt: DateLike;
  contractSignedAt: DateLike;
  chargeCreatedAt: DateLike;
  commissionPaidAt: DateLike;
}

/**
 * Regra canônica dos 5 marcos: evento real (envelope fechado / primeira
 * cobrança) tem precedência; scalar denormalizado do Deal (mark-signed manual,
 * chargeIssuedAt legado) é fallback.
 */
export function deriveDealMilestones(deal: DealMilestoneSource): DealMilestones {
  return {
    formOpenedAt: deal.form?.createdAt ?? null,
    formCompletedAt: deal.form?.completedAt ?? null,
    contractSignedAt: deal.envelopes[0]?.closedAt ?? deal.contractSignedAt ?? null,
    chargeCreatedAt:
      deal.commissionCharges[0]?.createdAt ?? deal.chargeIssuedAt ?? null,
    commissionPaidAt: deal.commissionPaidAt ?? null,
  };
}

function iso(d: DateLike): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

/** Marcos serializados (ISO) pra props de Client Component. */
export function serializeDealMilestones(
  deal: DealMilestoneSource
): Record<keyof DealMilestones, string | null> {
  const m = deriveDealMilestones(deal);
  return {
    formOpenedAt: iso(m.formOpenedAt),
    formCompletedAt: iso(m.formCompletedAt),
    contractSignedAt: iso(m.contractSignedAt),
    chargeCreatedAt: iso(m.chargeCreatedAt),
    commissionPaidAt: iso(m.commissionPaidAt),
  };
}

/**
 * Payload Prisma → DTO do KanbanCard. `slaStatus` e `daysInStage` são
 * computados AQUI (server) — o card só exibe, e server/client renderizam o
 * mesmo badge (nowMs serializado, React #418).
 *
 * Fallback pré-backfill: deal ativo ainda sem slaWarnAt/slaDueAt (migration
 * 20260806180000 não rodou) usa os defaults de código 5/10 — o badge "Xd
 * parado" não pode regredir no deploy que sai antes da migration.
 */
export function toDealCard(
  deal: DealForCard,
  nowMs: number,
  stageName?: string | null
): DealCard {
  const days = daysInStage(
    deal.stageEnteredAt?.toISOString() ?? null,
    deal.createdAt.toISOString(),
    nowMs
  );

  let slaStatus: SlaStatus | null = slaStatusFrom(deal, nowMs);
  if (deal.lostAt || isTerminalStageName(stageName)) {
    slaStatus = null;
  } else if (slaStatus === null) {
    slaStatus =
      days >= AGING_DANGER_DAYS
        ? "atrasado"
        : days >= AGING_WARN_DAYS
          ? "atencao"
          : "em_dia";
  }

  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    createdAt: deal.createdAt.toISOString(),
    clientName: deal.clientName,
    managerName: deal.manager ? deal.manager.name?.trim() || deal.manager.email : null,
    formStatus: deal.form?.status || null,
    formToken: deal.form?.token || null,
    hasContract: deal.contracts.length > 0,
    ...serializeDealMilestones(deal),
    lostAt: deal.lostAt?.toISOString() ?? null,
    lostReason: deal.lostReason ?? null,
    stageEnteredAt: deal.stageEnteredAt?.toISOString() ?? null,
    slaStatus,
    daysInStage: days,
  };
}
