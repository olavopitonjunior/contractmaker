import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
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

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
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
    actorUserId: session.user.id,
    orgId: org.id,
    dealData: { lostAt: null, lostReason: null },
    auditCtx: extractAuditContextFromRequest(req, org.id, session.user.id),
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
