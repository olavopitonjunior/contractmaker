/**
 * Corretores parceiros de uma proposta (venda e locação) — client-safe, puro.
 *
 * Um parceiro é um corretor (da casa ou de fora) que ACOMPANHA o negócio: recebe
 * e-mail quando a proposta é encaminhada e quando é assinada. Não assina nada,
 * não aparece no documento da proposta e NÃO é comissionado.
 *
 * Onde mora no `dataJson`: chave PRÓPRIA de topo, `corretores_parceiros[]`,
 * com o mesmo shape de linha do registry (`{ nome, creci, mobile_phone, email,
 * papel, splitRecipientId? }`). Uma chave própria — e não
 * `comissao.comissionados[]`/`angariadores[]` — é decisão de code review
 * (04/09/2026): aquelas listas são a DISTRIBUIÇÃO DA COMISSÃO e fluem verbatim
 * do convert para o contrato (a cláusula de intermediadora do CCV faz
 * `{{#if comissao.comissionados.length}}` e imprime cada linha como
 * intermediadora, suprimindo a imobiliária) e para o wizard de split (linha com
 * 0% que bloqueia a cobrança). Um parceiro que só recebe e-mail não pode cair
 * nesses dois lugares.
 *
 * O que lê esta chave: `resolveDealBrokers` (notificações do negócio depois da
 * conversão), o auto-cadastro no registry e a tela da proposta. Nenhum
 * template, nenhum `enrich*`, nenhum `deriveComissionados`.
 */

import { isValidCreci } from "@/lib/validators/corretor";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

/** Chave de topo no `dataJson` (proposta e, após o convert, SalesForm/Deal). */
export const PARTNER_BROKERS_KEY = "corretores_parceiros";

/** Linha do repeater da UI (e o que a API valida). */
export interface PartnerBrokerInput {
  /** Id no registry (SplitRecipient) quando veio da busca; vazio = inline. */
  splitRecipientId: string;
  nome: string;
  creci: string;
  phone: string;
  /** Opcional — sem e-mail o parceiro é só registro, não recebe aviso. */
  email: string;
}

/** Linha no `dataJson` (mesmo shape de linha do registry). */
export interface PartnerBrokerRow {
  nome: string;
  creci?: string;
  mobile_phone?: string;
  email?: string;
  papel?: string;
  splitRecipientId?: string;
}

export const MAX_PARTNER_BROKERS = 10;
export const PARTNER_BROKER_LIMITS = { nome: 120, creci: 50, phone: 30, email: 160 } as const;

/**
 * Papel no registry quando o parceiro é cadastrado por aqui: "intermediador"
 * — ele intermedeia o negócio; não é o angariador do imóvel (`captador`).
 */
export const PARTNER_BROKER_DEFAULT_PAPEL = "intermediador";

export const emptyPartnerBroker = (): PartnerBrokerInput => ({
  splitRecipientId: "",
  nome: "",
  creci: "",
  phone: "",
  email: "",
});

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Linhas com nome — as únicas que viram dado. */
export function validPartnerBrokers(list: PartnerBrokerInput[]): PartnerBrokerInput[] {
  return list.filter((p) => trim(p.nome).length > 0);
}

/**
 * Valida o repeater. Devolve mensagens em PT-BR (vazio = ok): teto, tamanhos,
 * CRECI com formato válido quando informado, telefone normalizável quando
 * informado, e-mail com forma de e-mail quando informado.
 */
export function validatePartnerBrokers(list: PartnerBrokerInput[]): string[] {
  const issues: string[] = [];
  const valid = validPartnerBrokers(list);
  if (valid.length > MAX_PARTNER_BROKERS) {
    issues.push(`No máximo ${MAX_PARTNER_BROKERS} corretores parceiros por proposta.`);
  }
  valid.forEach((p, i) => {
    const who = trim(p.nome) || `parceiro ${i + 1}`;
    if (trim(p.nome).length > PARTNER_BROKER_LIMITS.nome) {
      issues.push(`Nome longo demais para ${who}.`);
    }
    const creci = trim(p.creci);
    if (creci && (creci.length > PARTNER_BROKER_LIMITS.creci || !isValidCreci(creci))) {
      issues.push(`CRECI inválido para ${who}.`);
    }
    const phone = trim(p.phone);
    if (phone && (phone.length > PARTNER_BROKER_LIMITS.phone || !normalizeBrPhone(phone))) {
      issues.push(`Telefone inválido para ${who}.`);
    }
    const email = trim(p.email);
    if (
      email &&
      (email.length > PARTNER_BROKER_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      issues.push(`E-mail inválido para ${who}.`);
    }
  });
  return issues;
}

/** Repeater → linhas do `dataJson`. */
export function partnerBrokersToRows(list: PartnerBrokerInput[]): PartnerBrokerRow[] {
  return validPartnerBrokers(list).map((p) => {
    const row: PartnerBrokerRow = { nome: trim(p.nome), papel: PARTNER_BROKER_DEFAULT_PAPEL };
    if (trim(p.creci)) row.creci = trim(p.creci);
    const phone = trim(p.phone);
    if (phone) row.mobile_phone = normalizeBrPhone(phone) ?? phone;
    if (trim(p.email)) row.email = trim(p.email).toLowerCase();
    if (trim(p.splitRecipientId)) row.splitRecipientId = trim(p.splitRecipientId);
    return row;
  });
}

/** Linhas de `corretores_parceiros[]` do `dataJson` (qualquer origem). */
export function readPartnerBrokerRows(dataJson: unknown): PartnerBrokerRow[] {
  const data = (dataJson && typeof dataJson === "object" ? dataJson : {}) as Record<
    string,
    unknown
  >;
  const raw = data[PARTNER_BROKERS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      nome: trim(r.nome) || trim(r.razao_social),
      creci: trim(r.creci) || undefined,
      mobile_phone: trim(r.mobile_phone) || undefined,
      email: trim(r.email) || undefined,
      papel: trim(r.papel) || undefined,
      splitRecipientId: trim(r.splitRecipientId) || undefined,
    }))
    .filter((r) => r.nome.length > 0);
}

/** Inverso de `partnerBrokersToRows` (prefill da edição). */
export function partnerBrokersFromData(dataJson: unknown): PartnerBrokerInput[] {
  return readPartnerBrokerRows(dataJson).map((r) => ({
    splitRecipientId: r.splitRecipientId ?? "",
    nome: r.nome,
    creci: r.creci ?? "",
    phone: r.mobile_phone ?? "",
    email: r.email ?? "",
  }));
}

/**
 * Validação server-side do `dataJson` recebido na API (POST/PATCH), olhando só
 * a lista de parceiros. A rota não conhece o repeater — só o blob.
 */
export function validatePartnerBrokersInData(dataJson: unknown): string[] {
  return validatePartnerBrokers(partnerBrokersFromData(dataJson));
}
