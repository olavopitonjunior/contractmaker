/**
 * Commission builder — funções puras que lêem DadosContrato e geram payload
 * de cobrança para Asaas (sem side-effects, sem HTTP).
 *
 * Source of truth do DadosContrato: apps/web/src/lib/forms/validation.ts
 */

import type { CreatePaymentInput, CreateCustomerInput, AsaasSplit } from "./types";

// Tipo mínimo para trabalhar — reflete a parte de `comissao` do DadosContrato.
// Evita dep circular com lib/forms por enquanto; caller valida completude.
export interface DadosContratoLite {
  vendedores?: Array<PartyLike>;
  compradores?: Array<PartyLike>;
  pagamento?: {
    valor_total?: number | string;
  };
  comissao?: {
    valor?: number | string;
    percentual?: number | string;
    quem_paga?: "vendedor" | "comprador" | string;
    imobiliaria_nome?: string;
    imobiliaria_cnpj?: string;
  };
}

export interface PartyLike {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

export interface ResolvedPayer {
  papel: "comprador" | "vendedor";
  nome: string;
  cpfCnpj: string;
  email: string | null;
  mobilePhone: string | null;
  address: Partial<Pick<PartyLike, "endereco" | "numero" | "complemento" | "bairro" | "cidade" | "uf" | "cep">>;
}

export class CommissionBuildError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommissionBuildError";
    this.code = code;
  }
}

function extractCpfCnpj(p: PartyLike): string {
  const raw = (p.tipo_pessoa === "juridica" ? p.cnpj : p.cpf) ?? p.cpf ?? p.cnpj ?? "";
  return raw.replace(/\D/g, "");
}

function extractName(p: PartyLike): string {
  return (p.tipo_pessoa === "juridica" ? p.razao_social : p.nome) ?? p.nome ?? p.razao_social ?? "";
}

/**
 * Resolve quem é o pagador da comissão com base em `comissao.quem_paga`.
 * Default: comprador (o mais comum em venda).
 */
export function resolvePayer(data: DadosContratoLite): ResolvedPayer {
  const quemPaga = (data.comissao?.quem_paga ?? "comprador").toLowerCase();
  const source =
    quemPaga === "vendedor" || quemPaga.startsWith("vend")
      ? data.vendedores
      : data.compradores;

  if (!source || source.length === 0) {
    throw new CommissionBuildError(
      "NO_PAYER",
      `Nenhum ${quemPaga === "vendedor" ? "vendedor" : "comprador"} encontrado no contrato`
    );
  }

  const party = source[0];
  const nome = extractName(party);
  const cpfCnpj = extractCpfCnpj(party);

  if (!nome.trim()) {
    throw new CommissionBuildError(
      "NO_PAYER_NAME",
      "Pagador sem nome preenchido"
    );
  }
  if (!cpfCnpj || cpfCnpj.length < 11) {
    throw new CommissionBuildError(
      "NO_PAYER_CPF",
      "Pagador sem CPF/CNPJ preenchido — necessário para emitir cobrança"
    );
  }

  return {
    papel: quemPaga === "vendedor" ? "vendedor" : "comprador",
    nome,
    cpfCnpj,
    email: party.email || null,
    mobilePhone: null, // DadosContrato não captura celular — futuro
    address: {
      endereco: party.endereco,
      numero: party.numero,
      complemento: party.complemento,
      bairro: party.bairro,
      cidade: party.cidade,
      uf: party.uf,
      cep: party.cep,
    },
  };
}

function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    // Aceita "1.000,00", "1000.00", "1000"
    const cleaned = v.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Calcula o valor da comissão a cobrar.
 * Prioridade: `comissao.valor` > `comissao.percentual` × `pagamento.valor_total`.
 */
export function resolveCommissionValue(data: DadosContratoLite): number {
  const valor = parseNumber(data.comissao?.valor);
  if (valor > 0) return valor;

  const pct = parseNumber(data.comissao?.percentual);
  const total = parseNumber(data.pagamento?.valor_total);
  if (pct > 0 && total > 0) {
    return Math.round(((pct / 100) * total) * 100) / 100;
  }

  throw new CommissionBuildError(
    "NO_VALUE",
    "Não foi possível calcular o valor da comissão (faltam campos valor ou percentual+valor_total)"
  );
}

export interface BuildCommissionPayloadInput {
  contractData: DadosContratoLite;
  payer: ResolvedPayer;
  value: number;
  billingType: "PIX" | "BOLETO";
  dueDate: string; // YYYY-MM-DD
  description: string;
  externalReference: string;
  /** walletId da subconta Asaas da org (destino do split). */
  orgWalletId: string;
  /** Opcional: platform fee (Fase 3+). Se 0, split tem 1 linha. */
  platformFeePercent?: number;
  /** Opcional: walletId master do Contractmaker (Fase 3+). */
  platformWalletId?: string;
  /**
   * Splits custom por cobrança (Fase 5). Cada entry redireciona X% ou valor
   * fixo para uma wallet cadastrada em `SplitRecipient`. O remanescente fica
   * na subconta da org (comportamento default do Asaas).
   *
   * Se `platformWalletId + platformFeePercent` existir, a taxa de plataforma
   * é anexada automaticamente em cima desses custom splits.
   */
  customSplits?: AsaasSplit[];
}

export interface BuiltCommissionPayload {
  customerInput: CreateCustomerInput;
  paymentInput: Omit<CreatePaymentInput, "customer">;
}

/**
 * Monta customer + payment inputs para Asaas. Caller faz upsertCustomer →
 * createPayment em sequência.
 */
/**
 * Compõe e valida o array de splits a enviar para o Asaas.
 *
 * Regras aplicadas:
 *  1. Máximo 10 entries (limite Asaas)
 *  2. Sem duplicatas de walletId (Asaas rejeita)
 *  3. walletId próprio da org não permitido (Asaas rejeita; remanescente já cai lá)
 *  4. Soma de percentualValue ≤ 100
 *
 * Usado por `buildCommissionPayload` (flow Deal → commission-charges) e
 * também pelo flow de cobrança avulsa (`/api/financeiro/charges/nova`).
 *
 * Retorna `undefined` se nenhum split foi configurado — importante para
 * não enviar split vazio ao Asaas (que pode rejeitar).
 */
export function composeSplits(params: {
  customSplits?: AsaasSplit[];
  platformFeePercent?: number;
  platformWalletId?: string | null;
  orgWalletId: string;
}): AsaasSplit[] | undefined {
  const parts: AsaasSplit[] = [];

  if (params.customSplits?.length) {
    parts.push(...params.customSplits);
  }

  const platformPct = params.platformFeePercent ?? 0;
  if (platformPct > 0 && params.platformWalletId) {
    parts.push({
      walletId: params.platformWalletId,
      percentualValue: platformPct,
    });
  }

  if (parts.length === 0) return undefined;

  if (parts.length > 10) {
    throw new CommissionBuildError(
      "SPLIT_TOO_MANY",
      `Split excede limite de 10 destinatários (recebeu ${parts.length})`
    );
  }
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.walletId)) {
      throw new CommissionBuildError(
        "SPLIT_DUPLICATE_WALLET",
        `Wallet ID ${p.walletId} aparece mais de uma vez no split`
      );
    }
    seen.add(p.walletId);
    if (p.walletId === params.orgWalletId) {
      throw new CommissionBuildError(
        "SPLIT_SELF_WALLET",
        "Split não pode incluir o wallet ID da própria org — o remanescente já cai lá automaticamente"
      );
    }
    const pct = p.percentualValue ?? 0;
    const fx = p.fixedValue ?? 0;
    if (pct <= 0 && fx <= 0) {
      throw new CommissionBuildError(
        "SPLIT_EMPTY_VALUE",
        `Entry de split para ${p.walletId} precisa ter percentualValue > 0 ou fixedValue > 0`
      );
    }
  }
  const totalPct = parts.reduce((s, p) => s + (p.percentualValue ?? 0), 0);
  if (totalPct > 100) {
    throw new CommissionBuildError(
      "SPLIT_PERCENT_OVERFLOW",
      `Soma dos percentuais do split é ${totalPct}% (máximo 100%)`
    );
  }

  return parts;
}

export function buildCommissionPayload(
  input: BuildCommissionPayloadInput
): BuiltCommissionPayload {
  const { payer, value, billingType, dueDate, description, externalReference, orgWalletId } = input;

  const split = composeSplits({
    customSplits: input.customSplits,
    platformFeePercent: input.platformFeePercent,
    platformWalletId: input.platformWalletId,
    orgWalletId,
  });

  const customerInput: CreateCustomerInput = {
    name: payer.nome,
    cpfCnpj: payer.cpfCnpj,
    email: payer.email ?? undefined,
    address: payer.address.endereco ?? undefined,
    addressNumber: payer.address.numero ?? undefined,
    complement: payer.address.complemento ?? undefined,
    province: payer.address.bairro ?? undefined,
    postalCode: payer.address.cep?.replace(/\D/g, "") ?? undefined,
    externalReference,
  };

  const paymentInput: Omit<CreatePaymentInput, "customer"> = {
    billingType,
    value,
    dueDate,
    description,
    externalReference,
    split,
  };

  return { customerInput, paymentInput };
}
