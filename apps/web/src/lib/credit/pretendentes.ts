/**
 * Pretendentes da análise de crédito de uma proposta de LOCAÇÃO — client-safe,
 * puro. Deriva do `dataJson` (o shape do formulário de locação) quem é
 * consultado: locatários, cônjuges de locatário, fiador e cônjuge do fiador.
 *
 * É a fonte única para o editor de partes na tela da proposta, para o payload
 * da Ficha Certa (PR 6) e para o "faltando" que trava o disparo. O dataJson
 * que entra aqui já deve vir com o OCR aplicado (`applyProposalExtractions`)
 * quando se quer o que os documentos trouxeram.
 */

import { basePathForTarget } from "@/lib/certidoes/target-paths";
import { isValidCPF, isValidCNPJ } from "@/lib/forms/field-formats";
import { normalizeGarantiaTipo } from "@/lib/contracts/template-category";
import type { TipoImovel, TipoPretendente } from "@/lib/fichacerta/types";

export type PretendenteKind = "locatario" | "conjuge_locatario" | "fiador" | "conjuge_fiador";

export const PRETENDENTE_KIND_LABELS: Record<PretendenteKind, string> = {
  locatario: "Locatário",
  conjuge_locatario: "Cônjuge do locatário",
  fiador: "Fiador",
  conjuge_fiador: "Cônjuge do fiador",
};

const TIPO_PRETENDENTE: Record<PretendenteKind, Exclude<TipoPretendente, "OUTROS">> = {
  locatario: "INQUILINO",
  conjuge_locatario: "CONJUGE_INQUILINO",
  fiador: "FIADOR",
  conjuge_fiador: "CONJUGE_FIADOR",
};

export type PretendenteMissing = "nome" | "cpf" | "cnpj" | "data_nascimento";

export const PRETENDENTE_MISSING_LABELS: Record<PretendenteMissing, string> = {
  nome: "nome",
  cpf: "CPF válido",
  cnpj: "CNPJ válido",
  data_nascimento: "data de nascimento",
};

export interface PretendenteEndereco {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface Pretendente {
  kind: PretendenteKind;
  index: number;
  /** Caminho no dataJson (`locatarios.0`, `garantia.fiador.conjuge`…). */
  basePath: string;
  label: string;
  tipoPretendente: TipoPretendente;
  pessoa: "fisica" | "juridica";
  nome: string;
  cpf: string;
  cnpj: string;
  razaoSocial: string;
  dataNascimento: string;
  nomeMae: string;
  sexo: string;
  rg: string;
  email: string;
  telefone: string;
  endereco: PretendenteEndereco;
  rendaMensal: number | null;
  rendaOrigem: number | null;
  rendaOutraValor: number | null;
  rendaOutraOrigem: number | null;
  /** Residencial: vai morar no imóvel. Default true para locatário/cônjuge. */
  residir: boolean;
  /** Comercial: participa do negócio. Default true para locatário/cônjuge. */
  participante: boolean;
  missing: PretendenteMissing[];
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}
function digits(v: unknown): string {
  return str(v).replace(/\D/g, "");
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function intOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) ? n : null;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Tem identidade suficiente para existir como pretendente. */
function hasIdentity(p: Rec): boolean {
  return !!(digits(p.cpf) || digits(p.cnpj) || str(p.nome) || str(p.razao_social));
}

export function tipoImovelForSchema(schemaType: string | null | undefined): TipoImovel {
  return (schemaType ?? "").includes("comercial") ? "NAO_RESIDENCIAL" : "RESIDENCIAL";
}

function buildPretendente(kind: PretendenteKind, index: number, p: Rec, labelIndex: number | null): Pretendente {
  const pessoa: "fisica" | "juridica" =
    p.tipo_pessoa === "juridica" || (!!digits(p.cnpj) && !digits(p.cpf)) ? "juridica" : "fisica";
  const nome = str(p.nome) || str(p.razao_social);
  const cpf = digits(p.cpf);
  const cnpj = digits(p.cnpj);
  const dataNascimento = str(p.data_nascimento);
  const missing: PretendenteMissing[] = [];
  if (!nome) missing.push("nome");
  if (pessoa === "juridica") {
    if (!isValidCNPJ(cnpj)) missing.push("cnpj");
  } else {
    if (!isValidCPF(cpf)) missing.push("cpf");
    if (!dataNascimento) missing.push("data_nascimento");
  }
  const base = PRETENDENTE_KIND_LABELS[kind];
  const label = labelIndex != null ? `${base} ${labelIndex}` : base;
  const isTitular = kind === "locatario" || kind === "conjuge_locatario";
  return {
    kind,
    index,
    basePath: basePathForTarget(kind, index, "locacao"),
    label,
    tipoPretendente: pessoa === "juridica" ? "OUTROS" : TIPO_PRETENDENTE[kind],
    pessoa,
    nome,
    cpf,
    cnpj,
    razaoSocial: str(p.razao_social) || (pessoa === "juridica" ? nome : ""),
    dataNascimento,
    nomeMae: str(p.nome_mae),
    sexo: str(p.sexo),
    rg: str(p.rg),
    email: str(p.email),
    telefone: str(p.telefone) || str(p.mobile_phone),
    endereco: {
      cep: digits(p.cep),
      logradouro: str(p.endereco),
      numero: str(p.numero),
      complemento: str(p.complemento),
      bairro: str(p.bairro),
      cidade: str(p.cidade),
      uf: str(p.uf).toUpperCase(),
    },
    rendaMensal: num(p.renda_mensal),
    rendaOrigem: intOrNull(p.renda_origem),
    rendaOutraValor: num(p.renda_outra_valor),
    rendaOutraOrigem: intOrNull(p.renda_outra_origem),
    residir: bool(p.residir, isTitular),
    participante: bool(p.participante, isTitular),
    missing,
  };
}

/**
 * Locatários (N) → cônjuge de cada um (se tem nome ou CPF) → fiador (só quando
 * a garantia é fiança e ele tem identidade) → cônjuge do fiador. Ordem estável:
 * é a ordem das linhas do editor e dos jobs.
 */
export function derivePretendentes(dataJson: unknown): Pretendente[] {
  const d = rec(dataJson) ?? {};
  const out: Pretendente[] = [];
  const locatarios = Array.isArray(d.locatarios) ? d.locatarios : [];
  const multi = locatarios.length > 1;
  locatarios.forEach((raw, i) => {
    const p = rec(raw);
    if (!p) return;
    out.push(buildPretendente("locatario", i, p, multi ? i + 1 : null));
  });
  locatarios.forEach((raw, i) => {
    const p = rec(raw);
    const c = p ? rec(p.conjuge) : null;
    if (!c || !hasIdentity(c)) return;
    out.push(buildPretendente("conjuge_locatario", i, c, multi ? i + 1 : null));
  });
  const garantia = rec(d.garantia);
  const fiador = garantia ? rec(garantia.fiador) : null;
  if (garantia && normalizeGarantiaTipo(garantia.tipo) === "fiador" && fiador && hasIdentity(fiador)) {
    out.push(buildPretendente("fiador", 0, fiador, null));
    const cf = rec(fiador.conjuge);
    if (cf && hasIdentity(cf)) out.push(buildPretendente("conjuge_fiador", 0, cf, null));
  }
  return out;
}

/** Pretendentes que ainda não podem ir para a Ficha Certa (com o que falta). */
export function pretendentesIncompletos(list: Pretendente[]): Pretendente[] {
  return list.filter((p) => p.missing.length > 0);
}
