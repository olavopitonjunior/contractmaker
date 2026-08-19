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
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { resolveTemplateOverride } from "@/lib/contracts/template-category";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ templateId: z.string().min(1).optional() });

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

  // Escopo do gerente + CONTRACT_CREATE.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.CONTRACT_CREATE,
  });
  if (denied) return denied;

  // Body OPCIONAL (`templateId`). O `.catch(() => ({}))` é obrigatório aqui:
  // integrações e o Newton chamam esta rota sem corpo e sem Content-Type, e um
  // `req.json()` seco passaria a devolver 400 pra todas elas.
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "templateId inválido" }, { status: 400 });
  }
  let override;
  if (parsed.data.templateId) {
    const resolved = await resolveTemplateOverride({
      templateId: parsed.data.templateId,
      orgId: apiAuth.org.id,
      dealKind: deal.kind,
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: `Modelo inválido (${resolved.reason})` },
        { status: 400 }
      );
    }
    override = resolved.template;
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
      apiAuth.org.id,
      { template: override }
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
        metadata: mergeAuditMetadata(
          {
            kind: deal.kind,
            ...(override
              ? { templateOverrideId: override.id, templateName: override.name }
              : {}),
          },
          apiAuth.actor
        ),
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
