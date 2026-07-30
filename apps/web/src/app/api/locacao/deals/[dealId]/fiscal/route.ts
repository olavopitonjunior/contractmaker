import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  ensureLocacaoAccess,
  isRouteError,
  parseJsonBody,
} from "@/lib/locacao/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeSalesFormDataJson, FormNotFoundError } from "@/lib/forms/atomic-merge";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { fiscalAdministracaoSchema } from "@/lib/forms/validation-locacao";

export const runtime = "nodejs";

/**
 * PATCH /api/locacao/deals/[dealId]/fiscal
 *
 * Superfície do OPERADOR para os dados fiscais do contrato de ADMINISTRAÇÃO
 * (taxa de administração, regime de IR, regime de cobrança e NFS-e). Esses
 * campos saíram do diálogo de criação do formulário: quem os negocia é o
 * proprietário, no momento em que o instrumento de administração é gerado.
 *
 * Espelha `PATCH .../comissao`: merge atômico escopado numa chave só
 * (`fiscal`) no SalesForm.dataJson — que é de onde
 * `generateAdministracaoContractForDeal` lê — e sincronia com o LeaseContract
 * quando ele já existe (o contrato de LOCAÇÃO nasce antes do de administração,
 * e `createLeaseContractFromDataJson` já congelou os defaults nas colunas).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, fiscalAdministracaoSchema);
  if (!parsed.ok) return parsed.response;
  const fiscal = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      kind: true,
      formId: true,
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal || deal.kind !== "locacao") {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  // Deal não tem orgId direto — escopo via pipeline.orgId.
  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!deal.formId) {
    return NextResponse.json(
      { error: "Negócio sem formulário — dados fiscais não têm onde ser gravados." },
      { status: 409 }
    );
  }

  let merged: Record<string, unknown>;
  try {
    const outcome = await mergeSalesFormDataJson({
      where: { id: deal.formId },
      incoming: { fiscal },
      allowedTopKeys: ["fiscal"],
    });
    merged = outcome.finalData;
  } catch (error) {
    if (error instanceof FormNotFoundError) {
      return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });
    }
    throw error;
  }

  // Espelha no LeaseContract quando ele já nasceu: dataJson (snapshot do form)
  // + as COLUNAS, que são o que repasse/DIMOB/cobrança leem em runtime.
  const lease = await prisma.leaseContract.findFirst({
    where: { dealId: deal.id, orgId: ctx.orgId },
    select: { id: true, dataJson: true },
  });
  if (lease) {
    const leaseData = (lease.dataJson as Record<string, unknown> | null) ?? {};
    const synced = deepMergeAtPaths(
      structuredClone(leaseData),
      { fiscal },
      ["fiscal"]
    ).merged;
    await prisma.leaseContract.update({
      where: { id: lease.id },
      data: {
        dataJson: synced as Prisma.InputJsonValue,
        taxaAdminPercent: fiscal.taxa_admin_percent,
        regimeIr: fiscal.regime_ir,
        regimeCobranca: fiscal.regime_cobranca,
        emitirNfse: fiscal.emitir_nfse,
      },
    });
  }

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "FORM_UPDATE",
    result: "SUCCESS",
    resource: deal.formId,
    resourceType: "SalesForm",
    metadata: {
      kind: "locacao",
      scope: "fiscal",
      dealId: deal.id,
      taxaAdminPercent: fiscal.taxa_admin_percent,
      regimeIr: fiscal.regime_ir,
      regimeCobranca: fiscal.regime_cobranca,
      emitirNfse: fiscal.emitir_nfse,
      leaseContractId: lease?.id ?? null,
    },
  });

  return NextResponse.json({
    dealId: deal.id,
    fiscal: (merged.fiscal as Record<string, unknown> | undefined) ?? fiscal,
  });
}
