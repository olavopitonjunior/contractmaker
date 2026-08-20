import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { LOST_STAGE_NAME, stageConfigForKind } from "@/lib/pipeline/stage-config";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

const Body = z.object({
  reason: z.string().min(3).max(500),
  category: z
    .enum([
      // venda
      "desistencia",
      "imovel_vendido",
      "financiamento_negado",
      // locação
      "imovel_alugado",
      "garantia_recusada",
      "credito_reprovado",
      "outro",
    ])
    .optional(),
});

/**
 * POST /api/pipeline/deals/:dealId/mark-lost
 *
 * Move deal pra "Negócio perdido" — terminal alternativo a partir de qualquer
 * stage não-terminal. Captura motivo (categoria + texto livre) pra futuro
 * relatório de causas perdidas.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 }
    );
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

  const { terminalStages } = stageConfigForKind(deal.pipeline.kind);
  if (terminalStages.includes(deal.stage.name)) {
    return NextResponse.json(
      {
        error: `Negócio já está em estágio terminal ("${deal.stage.name}") — reabra antes de marcar como perdido`,
      },
      { status: 400 }
    );
  }

  const targetStage = deal.pipeline.stages.find(
    (s) => s.name === LOST_STAGE_NAME
  );
  if (!targetStage) {
    return NextResponse.json(
      { error: `Estágio "${LOST_STAGE_NAME}" não encontrado no pipeline` },
      { status: 400 }
    );
  }

  const formattedReason = parsed.data.category
    ? `[${parsed.data.category}] ${parsed.data.reason}`
    : parsed.data.reason;

  await moveDealStage({
    dealId: deal.id,
    toStageId: targetStage.id,
    reason: "mark_lost",
    actorUserId: ctx.userId,
    orgId: ctx.orgId,
    dealData: { lostAt: new Date(), lostReason: formattedReason },
    auditCtx: extractAuditContextFromRequest(req, ctx.orgId, ctx.userId),
    auditMetadata: {
      // `kind: "lost"` preservado — o reopen (pré-3.2) procura exatamente isto.
      kind: "lost",
      reason: parsed.data.reason,
      category: parsed.data.category ?? null,
    },
  });

  queueSurveyDispatch(deal.id, targetStage.name);

  return NextResponse.json({
    status: "perdido",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
