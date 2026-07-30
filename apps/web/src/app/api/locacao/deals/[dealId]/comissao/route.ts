import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
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
import { comissaoLocacaoSchema } from "@/lib/forms/validation-locacao";
import { autoRegisterFormCommissioners } from "@/lib/forms/auto-register-commissioners";

export const runtime = "nodejs";

/**
 * PATCH /api/locacao/deals/[dealId]/comissao
 *
 * Superfície do OPERADOR pra comissão da locação (corretagem +
 * angariadores). Existe separada do PATCH público `/api/locacao/forms/[token]`
 * de propósito:
 *
 *  - o link público é do cliente, e `comissao` está FORA de `ROLE_PATHS`
 *    (nem locador nem locatário nem fiador negociam comissão);
 *  - o público recusa form travado (`lockedAt`) e form já enviado quando quem
 *    chama não é membro da org — o operador precisa editar a comissão depois
 *    do envio, que é justamente quando ela é acertada.
 *
 * Escreve na chave `comissao` do SalesForm via merge atômico (allowlist de uma
 * chave só) e espelha no LeaseContract.dataJson quando ele já existe — é dali
 * que `materializeLeaseParties` monta os LeaseAngariador na ativação.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, comissaoLocacaoSchema);
  if (!parsed.ok) return parsed.response;
  const comissao = parsed.data;

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
      { error: "Negócio sem formulário — comissão não tem onde ser gravada." },
      { status: 409 }
    );
  }

  let merged: Record<string, unknown>;
  try {
    const outcome = await mergeSalesFormDataJson({
      where: { id: deal.formId },
      incoming: { comissao },
      allowedTopKeys: ["comissao"],
    });
    merged = outcome.finalData;
  } catch (error) {
    if (error instanceof FormNotFoundError) {
      return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });
    }
    throw error;
  }

  // Espelha no LeaseContract quando ele já nasceu (o snapshot do form fica
  // congelado lá; sem isto a ativação materializaria angariadores antigos).
  const lease = await prisma.leaseContract.findFirst({
    where: { dealId: deal.id, orgId: ctx.orgId },
    select: { id: true, dataJson: true },
  });
  if (lease) {
    const leaseData = (lease.dataJson as Record<string, unknown> | null) ?? {};
    const synced = deepMergeAtPaths(
      structuredClone(leaseData),
      { comissao },
      ["comissao"]
    ).merged;
    await prisma.leaseContract.update({
      where: { id: lease.id },
      data: { dataJson: synced as Prisma.InputJsonValue },
    });
  }

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "FORM_UPDATE",
    result: "SUCCESS",
    resource: deal.formId,
    resourceType: "SalesForm",
    metadata: {
      kind: "locacao",
      scope: "comissao",
      dealId: deal.id,
      angariadores: comissao.angariadores?.length ?? 0,
      taxaLocacaoPercent: comissao.taxa_locacao_percent ?? 0,
    },
  });

  // Auto-cadastro dos angariadores no registry de corretores (SplitRecipient
  // kind="commissioner"), mesmo helper de vendas — backfilla splitRecipientId
  // no dataJson. Fire-and-forget: nunca derruba o save da comissão.
  waitUntil(
    autoRegisterFormCommissioners({ formId: deal.formId, orgId: ctx.orgId })
  );

  return NextResponse.json({
    dealId: deal.id,
    comissao: (merged.comissao as Record<string, unknown> | undefined) ?? comissao,
  });
}
