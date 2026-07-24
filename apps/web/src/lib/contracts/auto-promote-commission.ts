import { prisma } from "@/lib/db/prisma";
import { WON_STAGE_BY_KIND } from "@/lib/pipeline/stage-config";
import { audit } from "@/lib/security/audit";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";

/**
 * Promove o deal pra "Comissão paga" (+ popula `commissionPaidAt`) quando o
 * Asaas confirma o PAGAMENTO da comissão (webhook PAYMENT_RECEIVED/CONFIRMED).
 *
 * Antes esse era o ÚNICO estágio que exigia clique manual (mark-commission-paid),
 * apesar de o webhook já saber que a comissão foi paga. Aqui replicamos a lógica
 * do endpoint manual:
 *  - só promove a partir de "Cobrança emitida" ou "Contrato assinado"
 *    (`ALLOWED_FROM`) — o guard impede que um webhook reentregue regrida um deal
 *    já em "Comissão paga"/"Perdido" ou avance um que nem chegou na cobrança;
 *  - alvo "Comissão paga"; se o pipeline não tiver essa stage (ex.: locação),
 *    vira no-op silencioso.
 *
 * Idempotente e fire-and-forget: nunca relança (o webhook não pode falhar por
 * causa da promoção). Retorna o resultado só pra teste/observabilidade.
 */
/** Estágios de origem válidos + alvo — fonte única (reusada pelo endpoint
 * manual mark-commission-paid, pra webhook e clique não divergirem). */
export const COMMISSION_PAID_ALLOWED_FROM = ["Cobrança emitida", "Contrato assinado"];
// Nome canônico vem de stage-config (client-safe) — fonte única.
export const COMMISSION_PAID_TARGET_STAGE = WON_STAGE_BY_KIND.venda;

export type CommissionPromoteResult =
  | { promoted: true; fromStageId: string; toStageId: string }
  | {
      promoted: false;
      reason:
        | "no_deal"
        | "deal_not_found"
        | "stage_missing"
        | "already_advanced"
        | "error";
    };

export async function autoPromoteDealOnCommissionPaid(
  dealId: string | null | undefined
): Promise<CommissionPromoteResult> {
  if (!dealId) return { promoted: false, reason: "no_deal" };
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        stage: { select: { id: true, name: true } },
        pipeline: {
          select: {
            id: true,
            orgId: true,
            stages: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!deal) return { promoted: false, reason: "deal_not_found" };

    if (!COMMISSION_PAID_ALLOWED_FROM.includes(deal.stage.name)) {
      // Já está em "Comissão paga"/"Perdido", ou ainda não chegou na cobrança —
      // não regride nem pula etapa.
      return { promoted: false, reason: "already_advanced" };
    }

    const targetStage = deal.pipeline.stages.find(
      (s) => s.name === COMMISSION_PAID_TARGET_STAGE
    );
    if (!targetStage) {
      // Pipeline sem "Comissão paga" (ex.: locação) — nada a promover.
      return { promoted: false, reason: "stage_missing" };
    }

    await prisma.deal.update({
      where: { id: deal.id },
      data: {
        stageId: targetStage.id,
        stageEnteredAt: new Date(),
        commissionPaidAt: new Date(),
      },
    });

    await audit(
      { orgId: deal.pipeline.orgId, userId: null },
      {
        action: "DEAL_STAGE_CHANGE",
        result: "SUCCESS",
        resource: deal.id,
        resourceType: "Deal",
        metadata: {
          kind: "auto_commission_paid",
          fromStage: deal.stage.id,
          toStage: targetStage.id,
        },
      }
    ).catch(() => {});

    queueSurveyDispatch(deal.id, targetStage.name);

    return {
      promoted: true,
      fromStageId: deal.stage.id,
      toStageId: targetStage.id,
    };
  } catch (err) {
    console.error("[auto-promote-commission] erro inesperado:", err);
    return { promoted: false, reason: "error" };
  }
}
