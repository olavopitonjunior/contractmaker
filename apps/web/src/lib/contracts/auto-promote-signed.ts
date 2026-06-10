import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

// Os nomes de stage diferem por tipo de pipeline. Mapas por `pipeline.kind`
// com fallback "venda" (kind null/legado) — não regride o fluxo de venda.
const LINEAR_ORDER_BY_KIND: Record<string, readonly string[]> = {
  venda: ["Formulário", "Confecção de Contrato", "Enviado para assinatura"],
  locacao: ["Formulário", "Em contrato"],
};

const TARGET_STAGE_BY_KIND: Record<string, string> = {
  venda: "Contrato assinado",
  // Locação (esteira comercial): ao fechar o envelope, o deal avança para
  // "Assinado". A administração (vistoria/cobrança/etc.) é o próximo passo,
  // representado pelo stage terminal "ADM" (handoff manual).
  locacao: "Assinado",
};

export type AutoPromoteResult =
  | { promoted: true; fromStageId: string; toStageId: string }
  | {
      promoted: false;
      reason:
        | "envelope_not_found"
        | "not_contract_envelope"
        | "stage_missing"
        | "already_advanced"
        | "deal_not_found";
    };

/**
 * Promove o stage do deal pra "Contrato assinado" quando o envelope vinculado
 * a um contrato é fechado. Compartilhado entre webhook ClickSign close,
 * route de sync manual e cron de fallback.
 *
 * Idempotente: chamar com envelope já processado retorna `already_advanced`.
 * Envelopes de attachment avulso (aditivos/distratos) retornam `not_contract_envelope`.
 *
 * Não relança erros — auditados via `audit()` com `result: "FAILURE"` quando
 * a stage destino não existe (caso histórico raro) e logged via `console.error`
 * em qualquer crash inesperado.
 */
export async function autoPromoteDealOnContractSigned(
  envelopeId: string
): Promise<AutoPromoteResult> {
  try {
    const envelope = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: {
        id: true,
        orgId: true,
        source: true,
        dealId: true,
      },
    });
    if (!envelope) {
      return { promoted: false, reason: "envelope_not_found" };
    }
    if (envelope.source !== "contract") {
      return { promoted: false, reason: "not_contract_envelope" };
    }

    const deal = await prisma.deal.findUnique({
      where: { id: envelope.dealId },
      include: {
        stage: { select: { id: true, name: true } },
        pipeline: {
          select: {
            id: true,
            kind: true,
            stages: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!deal) {
      return { promoted: false, reason: "deal_not_found" };
    }

    const kind = deal.pipeline.kind ?? "venda";
    const linearOrder: readonly string[] =
      LINEAR_ORDER_BY_KIND[kind] ?? LINEAR_ORDER_BY_KIND.venda;
    if (!linearOrder.includes(deal.stage.name)) {
      return { promoted: false, reason: "already_advanced" };
    }

    const targetStageName = TARGET_STAGE_BY_KIND[kind] ?? TARGET_STAGE_BY_KIND.venda;
    const targetStage = deal.pipeline.stages.find(
      (s) => s.name === targetStageName
    );
    if (!targetStage) {
      console.warn(
        `[auto-promote-signed] stage "${targetStageName}" não encontrada no pipeline ${deal.pipeline.id}`
      );
      return { promoted: false, reason: "stage_missing" };
    }

    await prisma.deal.update({
      where: { id: deal.id },
      data: { stageId: targetStage.id, stageEnteredAt: new Date() },
    });

    await audit(
      { orgId: envelope.orgId, userId: null },
      {
        action: "DEAL_STAGE_CHANGE",
        result: "SUCCESS",
        resource: deal.id,
        resourceType: "Deal",
        metadata: {
          kind: "auto_signed",
          fromStage: deal.stage.id,
          toStage: targetStage.id,
          envelopeId: envelope.id,
        },
      }
    ).catch(() => {});

    return {
      promoted: true,
      fromStageId: deal.stage.id,
      toStageId: targetStage.id,
    };
  } catch (err) {
    console.error("[auto-promote-signed] erro inesperado:", err);
    return { promoted: false, reason: "deal_not_found" };
  }
}
