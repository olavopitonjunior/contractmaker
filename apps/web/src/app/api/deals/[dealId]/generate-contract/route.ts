import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import {
  generateContractForDeal,
  generateLocacaoContractForDeal,
} from "@/lib/services/contract-generation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/deals/:dealId/generate-contract
 *
 * Bearer twin de `/api/pipeline/deals/:dealId/generate-contract`. Gera o
 * contrato do deal (Handlebars → Google Doc). Sem HITL — cria um rascunho
 * deletável; a aprovação do contrato (esta sim) é HITL via CONTRACT_APPROVE.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      kind: true,
      pipeline: { select: { orgId: true } },
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

  try {
    // Deals de locação usam o gerador próprio (template por schemaType +
    // enrichLocacaoData + upsert do LeaseContract). Os asserts de módulo
    // ficam dentro de cada gerador.
    const generate =
      deal.kind === "locacao"
        ? generateLocacaoContractForDeal
        : generateContractForDeal;
    const result = await generate(
      params.dealId,
      apiAuth.actor.effectiveUserId,
      apiAuth.org.id
    );

    await audit(
      extractAuditContextFromRequest(
        req,
        apiAuth.org.id,
        apiAuth.actor.effectiveUserId
      ),
      {
        action: "CONTRACT_GENERATE",
        result: "SUCCESS",
        resource: params.dealId,
        resourceType: "Deal",
        metadata: mergeAuditMetadata({ kind: deal.kind }, apiAuth.actor),
      }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Generate contract (bearer twin) error:", error);
    const message =
      error instanceof Error ? error.message : "Erro ao gerar contrato";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
