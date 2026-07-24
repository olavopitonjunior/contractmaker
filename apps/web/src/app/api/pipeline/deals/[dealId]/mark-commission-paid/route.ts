import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import {
  COMMISSION_PAID_ALLOWED_FROM,
  COMMISSION_PAID_TARGET_STAGE,
} from "@/lib/contracts/auto-promote-commission";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";

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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

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

  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: targetStage.id,
      stageEnteredAt: new Date(),
      commissionPaidAt: new Date(),
    },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_STAGE_CHANGE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      kind: "commission_paid",
      fromStage: deal.stage.id,
      toStage: targetStage.id,
    },
  });

  // Notificação do processo (manual — sem webhook Asaas neste caminho, então
  // não há charge_paid pra cobrir o momento).
  waitUntil(
    notifyDealEvent({
      dealId: deal.id,
      orgId: org.id,
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
