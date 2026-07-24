import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { LOST_STAGE_NAME, stageConfigForKind } from "@/lib/pipeline/stage-config";

export const runtime = "nodejs";

/**
 * POST /api/deals/:dealId/reopen
 *
 * Bearer twin de `/api/pipeline/deals/:dealId/reopen`. Tira o deal de
 * "Negócio perdido" e restaura a stage anterior (lookup no último AuditLog
 * `DEAL_STAGE_CHANGE` com `metadata.kind="lost"`; fallback por pipeline.kind).
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

  if (deal.stage.name !== LOST_STAGE_NAME) {
    return NextResponse.json(
      {
        error: `Negócio só pode ser reaberto se estiver em "${LOST_STAGE_NAME}" (está em "${deal.stage.name}")`,
      },
      { status: 400 }
    );
  }

  // Lookup do estágio prévio no último audit "lost" deste deal
  const lastLostAudit = await prisma.auditLog.findFirst({
    where: {
      action: "DEAL_STAGE_CHANGE",
      resource: deal.id,
      resourceType: "Deal",
    },
    orderBy: { createdAt: "desc" },
  });

  const previousStageId =
    lastLostAudit?.metadata &&
    typeof lastLostAudit.metadata === "object" &&
    !Array.isArray(lastLostAudit.metadata) &&
    (lastLostAudit.metadata as Record<string, unknown>).kind === "lost"
      ? ((lastLostAudit.metadata as Record<string, unknown>)
          .previousStageId as string | undefined)
      : undefined;

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

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: targetStage.id,
      stageEnteredAt: new Date(),
      lostAt: null,
      lostReason: null,
    },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "DEAL_STAGE_CHANGE",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: mergeAuditMetadata(
        {
          kind: "reopened",
          fromStage: deal.stage.id,
          toStage: targetStage.id,
          restoredFromAuditId: lastLostAudit?.id ?? null,
        },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    status: "reaberto",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
