import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/auth/context";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import {
  COMMISSION_PAID_ALLOWED_FROM,
  COMMISSION_PAID_TARGET_STAGE,
} from "@/lib/contracts/auto-promote-commission";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * POST /api/pipeline/deals/:dealId/mark-commission-paid
 *
 * Move deal pra "Comissão paga" e popula `commissionPaidAt`. Usado quando o
 * usuário recebeu a comissão (manual — não há trigger Asaas confiável pra
 * "dinheiro saiu da subconta e caiu na conta operacional").
 *
 * Aceita stage atual "Cobrança emitida" (caminho normal) ou "Contrato
 * assinado" (caso a charge tenha sido gerada fora do sistema).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  // `requireAuth` (e não `auth()` cru): sob impersonation de tenant,
  // `ctx.userId` é o DONO do tenant — é ele que tem membership/RBAC na org
  // impersonada. Com o id cru do super_admin o RBAC negava tudo (404/403).
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
    },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (!COMMISSION_PAID_ALLOWED_FROM.includes(deal.stage.name)) {
    return NextResponse.json(
      {
        error: `Negócio precisa estar em "Cobrança emitida" (está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === COMMISSION_PAID_TARGET_STAGE
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
    reason: "mark_commission_paid",
    actorUserId: ctx.userId,
    orgId: ctx.orgId,
    dealData: { commissionPaidAt: new Date() },
    auditCtx: extractAuditContextFromRequest(req, ctx.orgId, ctx.userId),
    auditMetadata: { kind: "commission_paid" },
  });

  // Notificação do processo (manual — sem webhook Asaas neste caminho, então
  // não há charge_paid pra cobrir o momento).
  waitUntil(
    notifyDealEvent({
      dealId: deal.id,
      orgId: ctx.orgId,
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
