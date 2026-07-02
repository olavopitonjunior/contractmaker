/**
 * Agregação de VENDAS para a DIMOB (registro R04 — intermediação de alienação).
 *
 * Lê os negócios de venda da org e monta as linhas do arquivo, aplicando as
 * regras da FAQ oficial da RFB:
 *   - Comissão declarada = a fatia do DECLARANTE (a própria org), não a soma de
 *     todos os comissionados (FAQ p24/p67). Em co-corretagem cada imobiliária
 *     declara só a sua parte.
 *   - Data da operação = data de assinatura do CCV (FAQ p52) → competência = ano
 *     da assinatura (Envelope.closedAt ?? Deal.contractSignedAt).
 *   - Múltiplos vendedores/compradores => uma linha por parte com rateio
 *     proporcional de valor e comissão (FAQ p23/p47/p60).
 *   - Intermediação (R04) NÃO tem "valor pago no ano" (isso é do R03 comercialização
 *     própria) — só valor da alienação + comissão do intermediário.
 *
 * Puro do ponto de vista de regra; só o carregamento inicial toca o banco.
 */

import { prisma } from "@/lib/db/prisma";
import {
  resolveCommissionValue,
  type DadosContratoLite,
  type PartyLike,
} from "@/lib/asaas/commission";

export interface DimobParty {
  nome: string;
  /** Só dígitos. */
  cpfCnpj: string;
}

export type CommissionSource =
  | "declarante_match" // casou o CNPJ da org entre os comissionados
  | "principal" // usou o comissionado papel=imobiliaria_principal / único
  | "total_fallback" // não identificou a fatia → usou a comissão total
  | "none"; // sem comissão declarada

export interface DimobSaleRecord {
  /** Chave estável para casar edições/overrides: `{dealId}:{idx do explode}`. */
  recordId: string;
  dealId: string;
  dealTitle: string;
  contractId: string;
  /** Origem legível por chave de campo do R04 (para o "de onde veio"). */
  fieldOrigins: Record<string, string>;
  comprador: DimobParty;
  vendedor: DimobParty;
  /** ISO yyyy-mm-dd da assinatura (data da operação). */
  dataOperacao: string;
  /** Reais, já rateado pela participação da parte. */
  valorAlienacao: number;
  /** Reais, comissão do declarante, já rateada. */
  valorComissao: number;
  numeroContrato: string | null;
  imovel: {
    endereco: string | null;
    cep: string | null;
    uf: string | null;
    tipoImovel: "urbano" | "rural" | null;
  };
  commissionSource: CommissionSource;
  /** true quando há múltiplos vendedores E compradores (rateio ambíguo → revisar). */
  needsReview: boolean;
}

export interface DimobDeclarante {
  cnpj: string; // dígitos
  nomeEmpresarial: string;
  cpfResponsavel: string; // dígitos
  endereco: string;
  uf: string;
  codigoMunicipio: string;
  municipioNome: string | null;
}

export interface DimobSalesAggregate {
  year: number;
  declarante: DimobDeclarante;
  /** Operações INCLUÍDAS (o que vai no TXT). */
  records: DimobSaleRecord[];
  /** Operações EXCLUÍDAS da declaração (para a lista de conciliação). */
  excluded: DimobSaleRecord[];
  /** Nenhuma operação INCLUÍDA no ano → dispensada de entrega (FAQ p6). */
  dispensado: boolean;
}

/** Separa os registros por deals excluídos. Puro e testável. */
export function partitionByExclusion(
  all: DimobSaleRecord[],
  excludedDealIds: Set<string>
): { records: DimobSaleRecord[]; excluded: DimobSaleRecord[] } {
  const records: DimobSaleRecord[] = [];
  const excluded: DimobSaleRecord[] = [];
  for (const r of all) {
    (excludedDealIds.has(r.dealId) ? excluded : records).push(r);
  }
  return { records, excluded };
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function partyName(p: PartyLike): string {
  return (
    (p.tipo_pessoa === "juridica" ? p.razao_social : p.nome) ??
    p.nome ??
    p.razao_social ??
    ""
  ).trim();
}

function partyDoc(p: PartyLike): string {
  const raw = (p.tipo_pessoa === "juridica" ? p.cnpj : p.cpf) ?? p.cpf ?? p.cnpj ?? "";
  return digits(raw);
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

interface ComissionadoLike {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: "fisica" | "juridica";
  papel?: string;
  percentual?: number | string;
  valor?: number | string;
}

/** Valor absoluto de um comissionado: valor > percentual×total. */
function comissionadoValue(c: ComissionadoLike, valorTotal: number): number {
  const v = toNumber(c.valor);
  if (v > 0) return v;
  const pct = toNumber(c.percentual);
  if (pct > 0 && valorTotal > 0) return Math.round(pct * valorTotal) / 100;
  return 0;
}

/**
 * Comissão do declarante para a operação. Identifica a fatia da própria org
 * (por CNPJ) entre os comissionados; se não achar, cai em heurísticas
 * transparentes (papel principal → único → comissão total).
 */
export function resolveDeclarantCommission(
  data: DadosContratoLite,
  orgCnpjDigits: string
): { value: number; source: CommissionSource } {
  const valorTotal = toNumber(data.pagamento?.valor_total);

  let totalCommission = 0;
  try {
    totalCommission = resolveCommissionValue(data);
  } catch {
    totalCommission = 0;
  }

  const comissionados = (
    data.comissao as { comissionados?: ComissionadoLike[] } | undefined
  )?.comissionados;

  if (comissionados && comissionados.length > 0) {
    const matched = comissionados.filter(
      (c) => orgCnpjDigits && digits(c.cnpj || c.cpf) === orgCnpjDigits
    );
    if (matched.length > 0) {
      const sum = matched.reduce((a, c) => a + comissionadoValue(c, valorTotal), 0);
      if (sum > 0) return { value: sum, source: "declarante_match" };
    }

    const principal =
      comissionados.find((c) => c.papel === "imobiliaria_principal") ??
      (comissionados.length === 1 ? comissionados[0] : undefined);
    if (principal) {
      const v = comissionadoValue(principal, valorTotal);
      if (v > 0) return { value: v, source: "principal" };
    }
  }

  if (totalCommission > 0) return { value: totalCommission, source: "total_fallback" };
  return { value: 0, source: "none" };
}

function buildImovel(data: DadosContratoLite): DimobSaleRecord["imovel"] {
  const imovel = (data as { imoveis?: Array<Record<string, unknown>> }).imoveis?.[0];
  if (!imovel) return { endereco: null, cep: null, uf: null, tipoImovel: null };
  const rua = String(imovel.rua ?? "").trim();
  const numero = String(imovel.numero ?? "").trim();
  const bairro = String(imovel.bairro ?? "").trim();
  const endereco = [rua, numero].filter(Boolean).join(", ") + (bairro ? ` - ${bairro}` : "");
  return {
    endereco: endereco.trim() || null,
    cep: digits(String(imovel.cep ?? "")) || null,
    uf: (String(imovel.uf ?? "").trim().toUpperCase() || null) as string | null,
    tipoImovel: null, // vendas não carregam tipoDimob; PGD assume urbano por default
  };
}

/** Origem legível por campo do R04 (para o drawer "de onde veio"). */
function buildFieldOrigins(
  vendIdx: number,
  compIdx: number,
  commissionSource: CommissionSource,
  rateado: boolean
): Record<string, string> {
  const rateio = rateado ? " (rateado por parte)" : "";
  return {
    cpfCnpjComprador: `dataJson.compradores[${compIdx}]`,
    nomeComprador: `dataJson.compradores[${compIdx}]`,
    cpfCnpjVendedor: `dataJson.vendedores[${vendIdx}]`,
    nomeVendedor: `dataJson.vendedores[${vendIdx}]`,
    dataContrato: "Envelope.closedAt ?? Deal.contractSignedAt (assinatura do CCV)",
    valorAlienacao: `dataJson.pagamento.valor_total${rateio}`,
    valorComissao: `comissão do declarante · fonte: ${commissionSource}${rateio}`,
    numeroContrato: "dataJson.comissao.numero_contrato",
    enderecoImovel: "dataJson.imoveis[0]",
    cepImovel: "dataJson.imoveis[0]",
    ufImovel: "dataJson.imoveis[0]",
  };
}

/**
 * Explode um negócio em 1+ linhas R04 aplicando rateio por parte.
 * Caso comum: 1 vendedor × 1 comprador → 1 linha. N vendedores → N linhas
 * (rateio igual). N compradores (com 1 vendedor) → N linhas.
 */
function explodeRecords(
  base: Omit<
    DimobSaleRecord,
    "recordId" | "fieldOrigins" | "comprador" | "vendedor" | "valorAlienacao" | "valorComissao" | "needsReview"
  >,
  vendedores: PartyLike[],
  compradores: PartyLike[],
  valorTotal: number,
  comissaoTotal: number
): DimobSaleRecord[] {
  const toParty = (p: PartyLike): DimobParty => ({ nome: partyName(p), cpfCnpj: partyDoc(p) });
  const multiParty = vendedores.length > 1 && compradores.length > 1;

  // Lado a explodir: prioriza vendedores (proprietários); senão compradores.
  const explodeVendedor = vendedores.length > 1 || compradores.length <= 1;
  const parts = explodeVendedor ? vendedores : compradores;
  const n = Math.max(parts.length, 1);

  return Array.from({ length: n }, (_, i) => {
    const vendIdx = explodeVendedor ? i : 0;
    const compIdx = explodeVendedor ? 0 : i;
    const vendedor = vendedores[vendIdx];
    const comprador = compradores[compIdx];
    return {
      ...base,
      recordId: `${base.dealId}:${i}`,
      fieldOrigins: buildFieldOrigins(vendIdx, compIdx, base.commissionSource, n > 1),
      comprador: comprador ? toParty(comprador) : { nome: "", cpfCnpj: "" },
      vendedor: vendedor ? toParty(vendedor) : { nome: "", cpfCnpj: "" },
      valorAlienacao: Math.round((valorTotal / n) * 100) / 100,
      valorComissao: Math.round((comissaoTotal / n) * 100) / 100,
      needsReview: multiParty,
    };
  });
}

/** Extrai o ano (UTC) de uma data, evitando drift de timezone. */
function yearOf(d: Date): number {
  return d.getUTCFullYear();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Monta o agregado da DIMOB de vendas para (org, ano). Não valida — a validação
 * (bloqueios de campo obrigatório) fica em validate.ts.
 */
export async function aggregateSalesForYear(
  orgId: string,
  year: number
): Promise<DimobSalesAggregate> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      cnpj: true,
      legalName: true,
      name: true,
      legalAddress: true,
      fiscalResponsibleCpf: true,
      fiscalUf: true,
      fiscalMunicipioCode: true,
      fiscalMunicipioName: true,
    },
  });

  const declarante: DimobDeclarante = {
    cnpj: digits(org?.cnpj),
    nomeEmpresarial: (org?.legalName || org?.name || "").trim(),
    cpfResponsavel: digits(org?.fiscalResponsibleCpf),
    endereco: (org?.legalAddress || "").trim(),
    uf: (org?.fiscalUf || "").trim().toUpperCase(),
    codigoMunicipio: digits(org?.fiscalMunicipioCode),
    municipioNome: org?.fiscalMunicipioName?.trim() || null,
  };

  const deals = await prisma.deal.findMany({
    where: { kind: "venda", pipeline: { orgId } },
    select: {
      id: true,
      title: true,
      contractSignedAt: true,
      contracts: {
        where: { isLatest: true, kind: "contract" },
        select: { id: true, dataJson: true },
        take: 1,
      },
      envelopes: {
        where: { source: "contract" },
        select: { closedAt: true },
      },
    },
  });

  const exclusions = await prisma.dimobExclusion.findMany({
    where: { orgId, year, dealId: { not: null } },
    select: { dealId: true },
  });
  const excludedDealIds = new Set(
    exclusions.map((e) => e.dealId).filter((d): d is string => d != null)
  );

  const allRecords: DimobSaleRecord[] = [];

  for (const deal of deals) {
    const contract = deal.contracts[0];
    if (!contract) continue;

    // Data da operação = maior closedAt de envelope de contrato, senão manual.
    const closedDates = deal.envelopes
      .map((e) => e.closedAt)
      .filter((d): d is Date => d != null);
    const operationDate =
      closedDates.length > 0
        ? new Date(Math.max(...closedDates.map((d) => d.getTime())))
        : deal.contractSignedAt ?? null;

    if (!operationDate || yearOf(operationDate) !== year) continue;

    const data = (contract.dataJson ?? {}) as DadosContratoLite;
    const vendedores = (data.vendedores ?? []) as PartyLike[];
    const compradores = (data.compradores ?? []) as PartyLike[];
    if (vendedores.length === 0 && compradores.length === 0) continue;

    const valorTotal = toNumber(data.pagamento?.valor_total);
    const { value: comissao, source } = resolveDeclarantCommission(data, declarante.cnpj);

    const numeroContrato =
      digits(String((data.comissao as { numero_contrato?: string })?.numero_contrato ?? "")) ||
      null;

    const base = {
      dealId: deal.id,
      dealTitle: deal.title ?? "",
      contractId: contract.id,
      dataOperacao: isoDate(operationDate),
      numeroContrato,
      imovel: buildImovel(data),
      commissionSource: source,
    };

    allRecords.push(
      ...explodeRecords(base, vendedores, compradores, valorTotal, comissao)
    );
  }

  const { records, excluded } = partitionByExclusion(allRecords, excludedDealIds);

  return {
    year,
    declarante,
    records,
    excluded,
    dispensado: records.length === 0,
  };
}
