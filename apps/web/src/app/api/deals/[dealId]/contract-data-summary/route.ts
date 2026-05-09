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
import {
  matchComissionadosToSplitRecipients,
  type ComissionadoLike,
} from "@/lib/asaas/commissionados-matcher";

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
 * Origem auditável do comissionado retornado para o wizard. UI usa pra
 * microcopy de "de onde veio esse dado".
 *   ccv.comissionados        — array explícito em dataJson.comissao.comissionados[]
 *   ccv.imobiliaria_principal — sintetizado dos campos planos imobiliaria_*
 *   manual                    — adicionado pelo operador no wizard (não retornado por este endpoint)
 */
type ComissionadoSource =
  | "ccv.comissionados"
  | "ccv.imobiliaria_principal"
  | "manual";

interface EnrichedComissionado {
  nome: string | undefined;
  cpf: string | undefined;
  cnpj: string | undefined;
  tipo_pessoa: "fisica" | "juridica" | undefined;
  email: string | undefined;
  mobile_phone: string | undefined;
  creci?: string;
  papel?: string;
  percentual: number | undefined;
  valor: number | undefined;
  source: ComissionadoSource;
  splitRecipientId: string | null;
  matchedBy: "cpf_cnpj" | "name" | null;
}

interface ComissaoLegada {
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  creci?: string;
  corretora_tipo_pessoa?: "fisica" | "juridica";
  valor?: number;
}

/**
 * Resolve a lista canônica de comissionados a partir de dataJson.comissao.
 *
 * Ordem de prioridade:
 *   1. comissionados[] explícito (preferência do operador, multi-corretora)
 *   2. campos planos imobiliaria_* (legado mono-corretora — sintetiza 1 entrada com 100%)
 *   3. lista vazia (contrato sem comissionado declarado)
 *
 * Para cada comissionado, faz match contra SplitRecipient cadastrados na
 * org (por CPF/CNPJ ou nome normalizado) — se houver match, retorna
 * splitRecipientId pra UI render linha verde "destinatário cadastrado".
 */
async function deriveComissionados(
  data: DadosContratoLite | null,
  orgId: string
): Promise<EnrichedComissionado[]> {
  if (!data?.comissao) return [];

  // 1) source of truth: comissionados[] explícito
  const explicit = (data.comissao as { comissionados?: ComissionadoLike[] })
    .comissionados;
  if (explicit && explicit.length > 0) {
    return enrichWithMatch(explicit, orgId, "ccv.comissionados");
  }

  // 2) fallback: imobiliaria_* (mono-corretora legado)
  const c = data.comissao as ComissaoLegada;
  if (!c.imobiliaria_nome) return [];

  const tipo = c.corretora_tipo_pessoa ?? "fisica";
  const synthesized: ComissionadoLike = {
    nome: c.imobiliaria_nome,
    cpf: tipo === "fisica" ? c.imobiliaria_cnpj ?? "" : "",
    cnpj: tipo === "juridica" ? c.imobiliaria_cnpj ?? "" : "",
    tipo_pessoa: tipo,
    email: c.imobiliaria_email,
    percentual: 100,
    valor: typeof c.valor === "number" ? c.valor : undefined,
  };
  return enrichWithMatch([synthesized], orgId, "ccv.imobiliaria_principal");
}

async function enrichWithMatch(
  list: ComissionadoLike[],
  orgId: string,
  source: ComissionadoSource
): Promise<EnrichedComissionado[]> {
  const recipients = await prisma.splitRecipient.findMany({
    where: { orgId, active: true },
  });
  const matches = matchComissionadosToSplitRecipients(list, recipients);
  return matches.map((m) => {
    const c = m.comissionado as ComissionadoLike & {
      creci?: string;
      papel?: string;
    };
    return {
      nome: c.nome,
      cpf: c.cpf,
      cnpj: c.cnpj,
      tipo_pessoa: c.tipo_pessoa,
      email: c.email,
      mobile_phone: c.mobile_phone,
      creci: c.creci,
      papel: c.papel,
      percentual: c.percentual,
      valor: c.valor,
      source,
      splitRecipientId: m.matchedRecipient?.id ?? null,
      matchedBy: m.matchedBy ?? null,
    };
  });
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

  const comissionados = await deriveComissionados(data, ctx.orgId);

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
    comissionados,
    suggestedPayer,
    payerError,
    suggestedValue,
    suggestedDueDate: due,
    formaPagamentoPreferida: formaDefault,
    modalidade: (data as { modalidade?: string })?.modalidade ?? null,
  });
}
