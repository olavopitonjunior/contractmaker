import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import {
  ensureLocacaoAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { waitUntil } from "@vercel/functions";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { guardDealScope } from "@/lib/deals/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/locacao/deals/[dealId]/aprovar-ficha
 *
 * Aprova a ficha do deal em "Em Aprovação" e move pra "Formulário" — o
 * próximo passo é o cliente completar a qualificação no link público.
 * Reprovação usa o mark-lost normal (categoria credito_reprovado).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: { select: { id: true, name: true } },
      pipeline: {
        select: { orgId: true, stages: { select: { id: true, name: true } } },
      },
    },
  });
  if (!deal || deal.kind !== "locacao") {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Escopo do gerente — acrescentado ao ensureLocacaoAccess(LEASE_CREATE).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });
  if (denied) return denied;

  if (deal.stage.name !== "Em Aprovação") {
    return NextResponse.json(
      {
        error: `Ficha só pode ser aprovada em "Em Aprovação" (negócio está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  const formularioStage = deal.pipeline.stages.find(
    (s) => s.name === "Formulário"
  );
  if (!formularioStage) {
    return NextResponse.json(
      { error: 'Estágio "Formulário" não encontrado no pipeline' },
      { status: 400 }
    );
  }

  await moveDealStage({
    dealId: deal.id,
    toStageId: formularioStage.id,
    reason: "aprovar_ficha",
    actorUserId: ctx.userId,
    orgId: ctx.orgId,
    auditCtx: extractAuditContextFromRequest(req, ctx.orgId, ctx.userId),
    auditMetadata: { kind: "ficha_aprovada" },
  });

  // Notificação do processo: ficha aprovada avança pra "Formulário".
  waitUntil(
    notifyDealEvent({
      dealId: deal.id,
      orgId: ctx.orgId,
      event: "stage_change",
      dedupeKey: stageChangeDedupeKey(formularioStage.id),
      context: { stageName: formularioStage.name },
    })
  );
  queueSurveyDispatch(deal.id, formularioStage.name);

  return NextResponse.json({
    status: "ficha_aprovada",
    dealId: deal.id,
    stageId: formularioStage.id,
    stageName: formularioStage.name,
  });
}
