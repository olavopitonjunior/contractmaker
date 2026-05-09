import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  resolvePayer,
  resolveCommissionValue,
  CommissionBuildError,
  type DadosContratoLite,
} from "@/lib/asaas/commission";
import { resolveDefaultDueDate } from "@/lib/asaas/due-date-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PartySummary {
  papel: "comprador" | "vendedor";
  index: number;
  nome: string;
  cpfCnpj: string;
  email: string | null;
  mobilePhone: string | null;
}

/**
 * GET /api/deals/[dealId]/contract-data-summary
 *
 * Retorna shape minimal pra alimentar o ChargeWizard sem precisar carregar
 * todo o DealDetail server-side. Inclui:
 *   - Lista de partes (vendedores + compradores) com dados de cobrança
 *   - Pagador sugerido (resolvePayer)
 *   - Valor de comissão sugerido
 *   - Vencimento default sugerido (heurística)
 *   - Comissionados extraídos
 *   - Forma de pagamento preferida
 *   - Status do contrato (aprovado? id?)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireAuth(req, { scope: "deals:r" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { dealId } = await params;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: {
      id: true,
      title: true,
      userId: true,
      contracts: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, status: true, dataJson: true, templateId: true },
      },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  // Sales scope lockdown
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (membership?.role === "sales" && deal.userId !== ctx.userId) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const contract = deal.contracts[0];
  const data = (contract?.dataJson ?? null) as DadosContratoLite | null;

  // Lista todas as partes (compradores + vendedores) — cada uma com index
  const parties: PartySummary[] = [];
  for (const [i, p] of (data?.compradores ?? []).entries()) {
    const nome =
      p.tipo_pessoa === "juridica"
        ? p.razao_social ?? p.nome ?? ""
        : p.nome ?? p.razao_social ?? "";
    const doc = (p.tipo_pessoa === "juridica" ? p.cnpj : p.cpf) ?? p.cpf ?? p.cnpj ?? "";
    parties.push({
      papel: "comprador",
      index: i,
      nome,
      cpfCnpj: doc.replace(/\D/g, ""),
      email: p.email || null,
      mobilePhone: (p as { mobile_phone?: string }).mobile_phone || null,
    });
  }
  for (const [i, p] of (data?.vendedores ?? []).entries()) {
    const nome =
      p.tipo_pessoa === "juridica"
        ? p.razao_social ?? p.nome ?? ""
        : p.nome ?? p.razao_social ?? "";
    const doc = (p.tipo_pessoa === "juridica" ? p.cnpj : p.cpf) ?? p.cpf ?? p.cnpj ?? "";
    parties.push({
      papel: "vendedor",
      index: i,
      nome,
      cpfCnpj: doc.replace(/\D/g, ""),
      email: p.email || null,
      mobilePhone: (p as { mobile_phone?: string }).mobile_phone || null,
    });
  }

  // Pagador sugerido
  let suggestedPayer: PartySummary | null = null;
  let suggestedValue: number | null = null;
  let payerError: string | null = null;
  if (data) {
    try {
      const p = resolvePayer(data);
      suggestedPayer = parties.find(
        (x) =>
          x.papel === p.papel &&
          x.cpfCnpj.replace(/\D/g, "") === p.cpfCnpj.replace(/\D/g, "")
      ) ?? null;
    } catch (err) {
      if (err instanceof CommissionBuildError) {
        payerError = err.message;
      }
    }
    try {
      suggestedValue = resolveCommissionValue(data);
    } catch {
      /* sem valor sugerido — UI pede pra digitar */
    }
  }

  const due = data
    ? resolveDefaultDueDate({
        modalidade: (data as { modalidade?: "a_vista" | "financiamento" }).modalidade,
        comissao: data.comissao,
      })
    : { iso: "", reason: "Sem dados de contrato" };

  const formaDefault =
    (data?.comissao as { forma_pagamento_preferida?: "pix" | "boleto" | "qualquer" })
      ?.forma_pagamento_preferida ?? "qualquer";

  return NextResponse.json({
    deal: { id: deal.id, title: deal.title },
    contract: contract
      ? {
          id: contract.id,
          status: contract.status,
          isImported: contract.templateId === null,
        }
      : null,
    parties,
    comissionados:
      (data?.comissao as { comissionados?: unknown[] })?.comissionados ?? [],
    suggestedPayer,
    payerError,
    suggestedValue,
    suggestedDueDate: due,
    formaPagamentoPreferida: formaDefault,
    modalidade: (data as { modalidade?: string })?.modalidade ?? null,
  });
}
