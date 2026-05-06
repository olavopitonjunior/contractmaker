import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

export const runtime = "nodejs";

/**
 * POST /api/deals/:dealId/mark-signed
 *
 * Newton-friendly Bearer twin de `/api/pipeline/deals/:dealId/mark-signed`.
 * Move deal de stage "Assinatura" para "Concluído". Sem HITL — operação
 * reversível via mover stage de volta.
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

  if (deal.stage.name !== "Assinatura") {
    return NextResponse.json(
      { error: `Negócio precisa estar no estágio "Assinatura" (está em "${deal.stage.name}")` },
      { status: 400 }
    );
  }

  const concluidoStage = deal.pipeline.stages.find((s) => s.name === "Concluído");
  if (!concluidoStage) {
    return NextResponse.json(
      { error: "Estágio Concluído não encontrado no pipeline" },
      { status: 400 }
    );
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: concluidoStage.id },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "DEAL_STAGE_CHANGE",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: mergeAuditMetadata(
        { fromStage: deal.stage.id, toStage: concluidoStage.id },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    status: "concluido",
    dealId: deal.id,
    stageId: concluidoStage.id,
    stageName: concluidoStage.name,
  });
}
