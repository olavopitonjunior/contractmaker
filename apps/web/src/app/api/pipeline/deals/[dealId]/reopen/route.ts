import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

/**
 * POST /api/pipeline/deals/:dealId/reopen
 *
 * Tira deal de "Negócio perdido" e devolve à stage anterior (lookup no último
 * AuditLog `DEAL_STAGE_CHANGE` com `metadata.kind="lost"`). Se não tiver
 * histórico, fallback pra "Confecção de Contrato".
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

  if (deal.stage.name !== "Negócio perdido") {
    return NextResponse.json(
      {
        error: `Negócio só pode ser reaberto se estiver em "Negócio perdido" (está em "${deal.stage.name}")`,
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

  const targetStage =
    (previousStageId
      ? deal.pipeline.stages.find((s) => s.id === previousStageId)
      : null) ??
    deal.pipeline.stages.find((s) => s.name === "Confecção de Contrato") ??
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
      lostAt: null,
      lostReason: null,
    },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_STAGE_CHANGE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      kind: "reopened",
      fromStage: deal.stage.id,
      toStage: targetStage.id,
      restoredFromAuditId: lastLostAudit?.id ?? null,
    },
  });

  return NextResponse.json({
    status: "reaberto",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
