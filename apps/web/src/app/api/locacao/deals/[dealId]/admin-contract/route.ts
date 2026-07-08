import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  ensureLocacaoAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { generateAdministracaoContractForDeal } from "@/lib/services/contract-generation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/locacao/deals/[dealId]/admin-contract
 *
 * Gera o CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO (imobiliária ↔ proprietário)
 * como Contract kind="administracao" no mesmo deal. Regerar cria nova versão
 * (isLatest por kind). Disponível em qualquer stage do deal — a administração
 * costuma ser fechada com o proprietário antes ou junto da locação.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      kind: true,
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal || deal.kind !== "locacao") {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await generateAdministracaoContractForDeal(
      deal.id,
      ctx.userId,
      ctx.orgId
    );

    await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
      action: "CONTRACT_GENERATE",
      result: "SUCCESS",
      resource: result.contractId,
      resourceType: "Contract",
      metadata: {
        kind: "administracao",
        dealId: deal.id,
        version: result.version,
      },
    });

    return NextResponse.json({
      contractId: result.contractId,
      version: result.version,
      googleDocUrl: result.googleDocUrl ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Falha ao gerar contrato de administração";
    console.error("[admin-contract] geração falhou:", err);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
