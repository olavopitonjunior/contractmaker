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
    quando_paga?: string;
    prazo_dias_apos_marco?: number;
    forma_pagamento_preferida?: "pix" | "boleto" | "qualquer";
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
  mobile_phone?: string;
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
 *
 * Aceita `partyIndex` para suportar compras conjuntas (escolher entre 2
 * compradores como cobrável principal). Aceita `override` para a UI
 * passar dados editados sem precisar persistir antes em DadosContrato.
 */
export interface ResolvePayerOpts {
  partyIndex?: number;
  override?: Partial<ResolvedPayer> & { papel?: "comprador" | "vendedor" };
}

export function resolvePayer(
  data: DadosContratoLite,
  opts: ResolvePayerOpts = {}
): ResolvedPayer {
  // Override total: se a UI já enviou nome+cpf+papel, confiamos
  if (
    opts.override?.nome &&
    opts.override.cpfCnpj &&
    opts.override.papel
  ) {
    return {
      papel: opts.override.papel,
      nome: opts.override.nome,
      cpfCnpj: opts.override.cpfCnpj,
      email: opts.override.email ?? null,
      mobilePhone: opts.override.mobilePhone ?? null,
      address: opts.override.address ?? {},
    };
  }

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

  const idx = Math.min(Math.max(opts.partyIndex ?? 0, 0), source.length - 1);
  const party = source[idx];
  const nome = opts.override?.nome ?? extractName(party);
  const cpfCnpj = opts.override?.cpfCnpj ?? extractCpfCnpj(party);

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
    email: opts.override?.email ?? party.email ?? null,
    mobilePhone:
      opts.override?.mobilePhone ?? (party.mobile_phone || null),
    address: opts.override?.address ?? {
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
 * Prioridade: `override` > `comissao.valor` > `comissao.percentual` × `pagamento.valor_total`.
 */
export function resolveCommissionValue(
  data: DadosContratoLite,
  opts: { override?: number } = {}
): number {
  if (typeof opts.override === "number" && opts.override > 0) return opts.override;

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

/**
 * Entry de split — pode ser wallet Asaas (split nativo) ou PIX externo
 * (transferência manual pós-pagamento). Discriminada por `recipientType`.
 *
 * Fase 5: só wallet. Fase 6: adicionou PIX externo.
 */
export type SplitInputEntry =
  | {
      recipientType: "asaas_wallet";
      /** SplitRecipient.id local (opcional — usado para rastreamento). */
      recipientId?: string;
      walletId: string;
      label?: string;
      percentualValue?: number;
      fixedValue?: number;
      totalFixedValue?: number;
    }
  | {
      recipientType: "pix_external";
      /** SplitRecipient.id local — obrigatório para idempotência da transferência. */
      recipientId: string;
      pixAddressKey: string;
      pixKeyType: string;
      ownerName: string;
      ownerCpfCnpj: string;
      label?: string;
      percentualValue?: number;
      fixedValue?: number;
    };

/**
 * Split externo (PIX) — não vai pro payload do Asaas. Persistido em
 * `CommissionCharge.splitJson.external` e disparado pelo dispatcher no
 * webhook PAYMENT_RECEIVED.
 */
export interface ExternalSplit {
  recipientId: string;
  pixAddressKey: string;
  pixKeyType: string;
  ownerName: string;
  ownerCpfCnpj: string;
  label?: string;
  percentualValue?: number;
  fixedValue?: number;
}

export interface ComposedSplits {
  /** Vai para `payment.split` na chamada Asaas (gratuito, instantâneo). */
  asaasSplits: AsaasSplit[] | undefined;
  /** Persistido em `splitJson.external` — dispatched após PAYMENT_RECEIVED. */
  externalSplits: ExternalSplit[];
}

/**
 * Bloco de display privado: informa ao corretor (e à UI interna) quais splits
 * NÃO devem aparecer no resumo de quem recebe. O valor de uma linha oculta é
 * mostrado consolidado dentro de uma linha visível (`consolidationMap`).
 *
 * O Asaas não expõe split publicamente, então isto é puramente exibição
 * interna — `generatePayerVisibleDescription` usa `hiddenRecipientIds` para
 * gerar a descrição da cobrança que o pagador efetivamente vê.
 */
export interface SplitDisplay {
  /**
   * IDs dos splits que devem aparecer como "Privado" na ChargeDetail e
   * cujos nomes não entram na descrição da cobrança. Usa `recipientId`
   * quando existe; quando não (split ad-hoc por walletId), usa `walletId`
   * ou `pixAddressKey` como ID.
   */
  hiddenRecipientIds: string[];
  /**
   * Mapa hiddenId → visibleId que herda visualmente o valor. UI computa
   * default (próxima visível) mas usuário pode override.
   */
  consolidationMap: Record<string, string>;
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
   * Splits custom por cobrança (Fase 5+6). Cada entry redireciona X% ou valor
   * fixo para uma wallet cadastrada em `SplitRecipient`. O remanescente fica
   * na subconta da org (comportamento default do Asaas).
   *
   * Se `platformWalletId + platformFeePercent` existir, a taxa de plataforma
   * é anexada automaticamente em cima desses custom splits.
   */
  customSplits?: SplitInputEntry[];
  /** Display block — repassado para persistência em splitJson.display. */
  display?: SplitDisplay;
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
 * Compõe e valida splits para uma cobrança.
 *
 * Recebe `SplitInputEntry[]` discriminados por `recipientType`. Separa em:
 *   - `asaasSplits` — entradas asaas_wallet + platform fee, vão para `payment.split`
 *   - `externalSplits` — entradas pix_external, persistidas e disparadas
 *     via dispatcher pós-PAYMENT_RECEIVED.
 *
 * Regras aplicadas (em conjunto, contando ambos os tipos):
 *  1. Máximo 10 splits Asaas (limite real do Asaas — externals não contam)
 *  2. Sem duplicatas de walletId (Asaas rejeita)
 *  3. walletId próprio da org não permitido (remanescente já cai lá)
 *  4. Sem duplicatas de recipientId entre os 2 tipos
 *  5. Soma de percentualValue (todos os tipos + platform fee) ≤ 100
 *  6. Cada entry precisa percentualValue > 0 OU fixedValue > 0
 *  7. PIX externos não podem usar `totalFixedValue` (não é PIX nativo Asaas)
 *
 * Retorna `{asaasSplits: undefined}` quando nenhum split Asaas foi definido —
 * importante para não enviar split vazio ao Asaas (que pode rejeitar).
 */
export function composeSplits(params: {
  customSplits?: SplitInputEntry[];
  platformFeePercent?: number;
  platformWalletId?: string | null;
  orgWalletId: string;
}): ComposedSplits {
  const asaasSplits: AsaasSplit[] = [];
  const externalSplits: ExternalSplit[] = [];

  for (const entry of params.customSplits ?? []) {
    const pct = entry.percentualValue ?? 0;
    const fx = entry.fixedValue ?? 0;
    if (pct <= 0 && fx <= 0) {
      const ref =
        entry.recipientType === "asaas_wallet"
          ? entry.walletId
          : entry.pixAddressKey;
      throw new CommissionBuildError(
        "SPLIT_EMPTY_VALUE",
        `Entry de split para ${ref} precisa ter percentualValue > 0 ou fixedValue > 0`
      );
    }

    if (entry.recipientType === "asaas_wallet") {
      asaasSplits.push({
        walletId: entry.walletId,
        percentualValue: entry.percentualValue,
        fixedValue: entry.fixedValue,
        totalFixedValue: entry.totalFixedValue,
      });
    } else {
      externalSplits.push({
        recipientId: entry.recipientId,
        pixAddressKey: entry.pixAddressKey,
        pixKeyType: entry.pixKeyType,
        ownerName: entry.ownerName,
        ownerCpfCnpj: entry.ownerCpfCnpj,
        label: entry.label,
        percentualValue: entry.percentualValue,
        fixedValue: entry.fixedValue,
      });
    }
  }

  // Platform fee é sempre wallet Asaas (master Contractmaker)
  const platformPct = params.platformFeePercent ?? 0;
  if (platformPct > 0 && params.platformWalletId) {
    asaasSplits.push({
      walletId: params.platformWalletId,
      percentualValue: platformPct,
    });
  }

  // Validações conjuntas
  if (asaasSplits.length > 10) {
    throw new CommissionBuildError(
      "SPLIT_TOO_MANY",
      `Split Asaas excede limite de 10 destinatários (recebeu ${asaasSplits.length}). PIX externos não contam.`
    );
  }

  const seenWallet = new Set<string>();
  for (const s of asaasSplits) {
    if (seenWallet.has(s.walletId)) {
      throw new CommissionBuildError(
        "SPLIT_DUPLICATE_WALLET",
        `Wallet ID ${s.walletId} aparece mais de uma vez no split`
      );
    }
    seenWallet.add(s.walletId);
    if (s.walletId === params.orgWalletId) {
      throw new CommissionBuildError(
        "SPLIT_SELF_WALLET",
        "Split não pode incluir o wallet ID da própria org — o remanescente já cai lá automaticamente"
      );
    }
  }

  const seenRecipient = new Set<string>();
  for (const entry of params.customSplits ?? []) {
    const rid = entry.recipientId;
    if (rid && seenRecipient.has(rid)) {
      throw new CommissionBuildError(
        "SPLIT_DUPLICATE_RECIPIENT",
        `Beneficiário ${rid} aparece mais de uma vez no split`
      );
    }
    if (rid) seenRecipient.add(rid);
  }

  const totalPct =
    asaasSplits.reduce((s, p) => s + (p.percentualValue ?? 0), 0) +
    externalSplits.reduce((s, p) => s + (p.percentualValue ?? 0), 0);
  if (totalPct > 100.001) {
    // 0.001 tolerância para float
    throw new CommissionBuildError(
      "SPLIT_PERCENT_OVERFLOW",
      `Soma dos percentuais do split é ${totalPct.toFixed(2)}% (máximo 100%)`
    );
  }

  return {
    asaasSplits: asaasSplits.length > 0 ? asaasSplits : undefined,
    externalSplits,
  };
}

export interface BuiltCommissionPayloadV2 extends BuiltCommissionPayload {
  /** Splits externos (PIX) — para persistir em splitJson.external e disparar pós-pagamento. */
  externalSplits: ExternalSplit[];
  /** Bloco de display interno (hiddenRecipientIds + consolidationMap). */
  display?: SplitDisplay;
}

/**
 * Gera a `description` da cobrança que o pagador vê (no email do Asaas, no
 * /pay/[token], na fatura). Omite comissionados marcados como ocultos.
 *
 * Quando hidden está vazio: lista todos os comissionados visíveis.
 * Quando todos estão ocultos: fallback pra dealTitle / categoryLabel sozinhos.
 */
export function generatePayerVisibleDescription(params: {
  splits: SplitInputEntry[];
  hiddenRecipientIds: string[];
  dealTitle?: string | null;
  kind: "commission" | "avulsa" | "aluguel" | "outros";
  categoryLabel?: string | null;
}): string {
  const { splits, hiddenRecipientIds, dealTitle, kind, categoryLabel } = params;
  const hidden = new Set(hiddenRecipientIds);
  const isHidden = (s: SplitInputEntry): boolean => {
    const id =
      s.recipientId ??
      (s.recipientType === "asaas_wallet" ? s.walletId : s.pixAddressKey);
    return hidden.has(id);
  };

  const visibleNames = splits
    .filter((s) => !isHidden(s))
    .map((s) => s.label)
    .filter((n): n is string => !!n && n.trim().length > 0);

  const titlePart = dealTitle ? ` — ${dealTitle}` : "";

  if (kind === "commission") {
    const namesStr =
      visibleNames.length > 0 ? ` (${visibleNames.join(", ")})` : "";
    return `Comissão${titlePart}${namesStr}`.trim();
  }

  // Avulsa/aluguel/outros usam categoryLabel quando existe
  const cat = (categoryLabel ?? "").trim() || "Cobrança";
  return `${cat}${titlePart}`.trim();
}

export function buildCommissionPayload(
  input: BuildCommissionPayloadInput
): BuiltCommissionPayloadV2 {
  const { payer, value, billingType, dueDate, description, externalReference, orgWalletId } = input;

  const { asaasSplits, externalSplits } = composeSplits({
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
    split: asaasSplits,
  };

  return { customerInput, paymentInput, externalSplits, display: input.display };
}
