import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { LOST_STAGE_NAME, stageConfigForKind } from "@/lib/pipeline/stage-config";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

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
 * POST /api/deals/:dealId/mark-lost
 *
 * Bearer twin de `/api/pipeline/deals/:dealId/mark-lost`. Move deal pra
 * "Negócio perdido" a partir de qualquer stage não-terminal, com motivo.
 * Sem HITL — reversível via /reopen.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

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

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: targetStage.id,
      stageEnteredAt: new Date(),
      lostAt: new Date(),
      lostReason: formattedReason,
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
          kind: "lost",
          reason: parsed.data.reason,
          category: parsed.data.category ?? null,
          previousStageId: deal.stage.id,
          previousStageName: deal.stage.name,
          toStage: targetStage.id,
        },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({
    status: "perdido",
    dealId: deal.id,
    stageId: targetStage.id,
    stageName: targetStage.name,
  });
}
