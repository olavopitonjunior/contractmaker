import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { moveDealStage } from "@/lib/pipeline/move-stage";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { LOST_STAGE_NAME, stageConfigForKind } from "@/lib/pipeline/stage-config";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * POST /api/pipeline/deals/:dealId/reopen
 *
 * Tira deal de "Negócio perdido" e devolve à stage anterior (lookup no último
 * AuditLog `DEAL_STAGE_CHANGE` com `metadata.kind="lost"`). Se não tiver
 * histórico, fallback por pipeline.kind (REOPEN_FALLBACK_BY_KIND).
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

  if (deal.stage.name !== LOST_STAGE_NAME) {
    return NextResponse.json(
      {
        error: `Negócio só pode ser reaberto se estiver em "${LOST_STAGE_NAME}" (está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  // Estágio prévio: DealStageHistory primeiro (o intervalo ABERTO do deal é o
  // do stage "perdido"; seu fromStageId é de onde ele veio — robusto contra
  // audits posteriores, que quebravam o lookup antigo). AuditLog fica como
  // FALLBACK pra deals perdidos antes do histórico existir.
  const openHist = await prisma.dealStageHistory.findFirst({
    where: { dealId: deal.id, exitedAt: null },
    select: { fromStageId: true, reason: true },
  });
  let previousStageId: string | undefined =
    openHist && openHist.reason === "mark_lost" && openHist.fromStageId
      ? openHist.fromStageId
      : undefined;

  let lastLostAudit: { id: string } | null = null;
  if (!previousStageId) {
    const auditRow = await prisma.auditLog.findFirst({
      where: {
        action: "DEAL_STAGE_CHANGE",
        resource: deal.id,
        resourceType: "Deal",
      },
      orderBy: { createdAt: "desc" },
    });
    lastLostAudit = auditRow;
    previousStageId =
      auditRow?.metadata &&
      typeof auditRow.metadata === "object" &&
      !Array.isArray(auditRow.metadata) &&
      (auditRow.metadata as Record<string, unknown>).kind === "lost"
        ? ((auditRow.metadata as Record<string, unknown>)
            .previousStageId as string | undefined)
        : undefined;
  }

  const { reopenFallback } = stageConfigForKind(deal.pipeline.kind);
  const targetStage =
    (previousStageId
      ? deal.pipeline.stages.find((s) => s.id === previousStageId)
      : null) ??
    deal.pipeline.stages.find((s) => s.name === reopenFallback) ??
    deal.pipeline.stages[0];

  if (!targetStage) {
    return NextResponse.json(
      { error: "Pipeline sem estágios — não foi possível reabrir" },
      { status: 400 }
    );
  }

  await moveDealStage({
    dealId: deal.id,
    toStageId: targetStage.id,
    reason: "reopen",
    actorUserId: ctx.userId,
    orgId: ctx.orgId,
    dealData: { lostAt: null, lostReason: null },
    auditCtx: extractAuditContextFromRequest(req, ctx.orgId, ctx.userId),
    auditMetadata: {
      kind: "reopened",
      restoredFromAuditId: lastLostAudit?.id ?? null,
    },
  });

  queueSurveyDispatch(deal.id, targetStage.name);

  return NextResponse.json({
    status: "reaberto",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
