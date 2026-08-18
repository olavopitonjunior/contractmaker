import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { notifyDealEvent, stageChangeDedupeKey } from "@/lib/notifications/deal-events";
import { waitUntil } from "@vercel/functions";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * POST /api/deals/:dealId/mark-signed
 *
 * Newton-friendly Bearer twin de `/api/pipeline/deals/:dealId/mark-signed`.
 * Move deal pra "Comissão paga" (terminal único pós-fusão de "Concluído").
 * Aceita origens "Enviado para assinatura", "Contrato assinado" ou "Cobrança
 * emitida". Sem HITL — reversível movendo stage de volta.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      form: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  const ALLOWED_FROM = [
    "Enviado para assinatura",
    "Contrato assinado",
    "Cobrança emitida",
  ];
  if (!ALLOWED_FROM.includes(deal.stage.name)) {
    return NextResponse.json(
      {
        error: `Negócio precisa estar entre "Enviado para assinatura" e "Cobrança emitida" (está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === "Comissão paga"
  );
  if (!targetStage) {
    return NextResponse.json(
      { error: 'Estágio "Comissão paga" não encontrado no pipeline' },
      { status: 400 }
    );
  }

  await moveDealStage({
    dealId: deal.id,
    toStageId: targetStage.id,
    reason: "mark_signed",
    actorUserId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    dealData: { commissionPaidAt: new Date() },
    auditCtx: extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    auditMetadata: mergeAuditMetadata({ kind: "commission_paid" }, apiAuth.actor),
  });

  // Notificação do processo — espelha o gêmeo de sessão em
  // /api/pipeline/deals/[dealId]/mark-signed. A mudança de status importa por
  // si; se foi o Newton ou um humano que marcou, o corretor não precisa saber.
  waitUntil(
    notifyDealEvent({
      dealId: deal.id,
      orgId: apiAuth.org.id,
      event: "stage_change",
      dedupeKey: stageChangeDedupeKey(targetStage.id),
      context: { stageName: targetStage.name },
    })
  );

  queueSurveyDispatch(deal.id, targetStage.name);

  return NextResponse.json({
    status: "comissao_paga",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
