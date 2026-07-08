import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

const ACTIVE_CHARGE_STATUSES_NEGATED = [
  "CANCELLED",
  "REFUNDED",
  "REFUND_PENDING",
  "CHARGEBACK",
] as const;

export type RegressResult =
  | { regressed: true; fromStageId: string; toStageId: string; toStageName: string }
  | {
      regressed: false;
      reason:
        | "deal_not_found"
        | "deal_terminal"
        | "not_in_charges_stage"
        | "still_has_active_charges"
        | "no_target_stage";
    };

/**
 * Regride o stage do deal de "Cobrança emitida" para o stage correto
 * (Contrato assinado se existe envelope source=contract closed; senão
 * Enviado para assinatura) quando a última cobrança ativa é cancelada.
 *
 * Não mexe em deals terminais (Comissão paga, Negócio perdido) — caller
 * que decida se quer reabrir.
 */
export async function regressDealStageAfterChargeCancel(
  dealId: string | null,
  actor: { orgId: string; userId: string | null }
): Promise<RegressResult> {
  if (!dealId) return { regressed: false, reason: "deal_not_found" };

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      stage: { select: { id: true, name: true } },
      pipeline: { include: { stages: { select: { id: true, name: true } } } },
    },
  });
  if (!deal) return { regressed: false, reason: "deal_not_found" };
  if (deal.commissionPaidAt || deal.lostAt) {
    return { regressed: false, reason: "deal_terminal" };
  }
  if (deal.stage.name !== "Cobrança emitida") {
    return { regressed: false, reason: "not_in_charges_stage" };
  }

  const activeCount = await prisma.commissionCharge.count({
    where: {
      dealId,
      status: { notIn: [...ACTIVE_CHARGE_STATUSES_NEGATED] },
      cancelledAt: null,
    },
  });
  if (activeCount > 0) {
    return { regressed: false, reason: "still_has_active_charges" };
  }

  const closedEnvelopes = await prisma.envelope.count({
    where: { dealId, source: "contract", status: "closed", contract: { kind: "contract" } },
  });
  const targetName =
    closedEnvelopes > 0 ? "Contrato assinado" : "Enviado para assinatura";
  const targetStage = deal.pipeline.stages.find((s) => s.name === targetName);
  if (!targetStage) {
    return { regressed: false, reason: "no_target_stage" };
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: targetStage.id, stageEnteredAt: new Date() },
  });

  await audit(
    { orgId: actor.orgId, userId: actor.userId },
    {
      action: "DEAL_STAGE_CHANGE",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: {
        kind: "charge_cancelled_regress",
        fromStage: deal.stage.id,
        toStage: targetStage.id,
        toStageName: targetStage.name,
      },
    }
  ).catch(() => {});

  return {
    regressed: true,
    fromStageId: deal.stage.id,
    toStageId: targetStage.id,
    toStageName: targetStage.name,
  };
}
