/**
 * Allowlist da rota `PATCH /api/proposals/[id]/partes` — client-safe, puro.
 *
 * Quais chaves de uma parte podem ser escritas pela tela da proposta depois
 * da criação, e com que tipo. Identidade (`nome`, `cpf`, `cnpj`,
 * `razao_social`) só entra quando o campo está VAZIO no dataJson: trocar o
 * CPF de um proponente já enviado é outra proposta, não uma correção.
 */

import type { TargetKind } from "@/lib/certidoes/types";
import { basePathForTarget, type CertidoesEsteira } from "@/lib/certidoes/target-paths";

export type PartyFieldType = "string" | "number" | "boolean";

/** Chaves editáveis por parte, com o tipo esperado. */
export const PARTY_FIELD_TYPES: Readonly<Record<string, PartyFieldType>> = {
  nome: "string",
  razao_social: "string",
  cpf: "string",
  cnpj: "string",
  rg: "string",
  sexo: "string",
  data_nascimento: "string",
  nome_mae: "string",
  estado_civil: "string",
  nacionalidade: "string",
  profissao: "string",
  email: "string",
  telefone: "string",
  mobile_phone: "string",
  endereco: "string",
  numero: "string",
  complemento: "string",
  bairro: "string",
  cidade: "string",
  uf: "string",
  cep: "string",
  renda_mensal: "number",
  renda_origem: "number",
  renda_outra_valor: "number",
  renda_outra_origem: "number",
  faturamento_mensal: "number",
  residir: "boolean",
  participante: "boolean",
};

/** Só gravadas quando ainda vazias no dataJson. */
export const PARTY_IDENTITY_FIELDS: ReadonlySet<string> = new Set(["nome", "razao_social", "cpf", "cnpj"]);

/** Alvos que a rota aceita por esteira (cônjuges podem ser CRIADOS sob o pai). */
const TARGETS_BY_ESTEIRA: Record<CertidoesEsteira, ReadonlySet<TargetKind>> = {
  locacao: new Set<TargetKind>(["locatario", "conjuge_locatario", "locador", "fiador", "conjuge_fiador"]),
  venda: new Set<TargetKind>(["vendedor", "comprador", "conjuge_vendedor"]),
};

export function isPartyTargetAllowed(kind: string, esteira: CertidoesEsteira): kind is TargetKind {
  return (TARGETS_BY_ESTEIRA[esteira] as ReadonlySet<string>).has(kind);
}

/** Alvos-cônjuge: nascem sob o pai quando ainda não existem. */
export const SPOUSE_TARGETS: ReadonlySet<string> = new Set(["conjuge_locatario", "conjuge_fiador", "conjuge_vendedor"]);

const MAX_STRING = 200;

export interface PartyFieldsValidation {
  ok: true;
  fields: Record<string, string | number | boolean>;
}
export interface PartyFieldsError {
  ok: false;
  error: string;
}

/**
 * Valida e normaliza `fields` contra a allowlist. Strings vão aparadas; `""`
 * apaga o campo (vira `undefined` no merge). Números precisam ser finitos e
 * ≥ 0; booleanos, booleanos.
 */
export function validatePartyFields(raw: unknown): PartyFieldsValidation | PartyFieldsError {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "fields inválido" };
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const type = PARTY_FIELD_TYPES[key];
    if (!type) return { ok: false, error: `Campo não permitido: ${key}` };
    if (value === null || value === undefined) {
      out[key] = "";
      continue;
    }
    if (type === "string") {
      if (typeof value !== "string") return { ok: false, error: `Campo ${key} deve ser texto` };
      out[key] = value.trim().slice(0, MAX_STRING);
    } else if (type === "number") {
      if (value === "") {
        out[key] = "";
        continue;
      }
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `Campo ${key} deve ser número` };
      out[key] = n;
    } else {
      if (typeof value !== "boolean") return { ok: false, error: `Campo ${key} deve ser verdadeiro/falso` };
      out[key] = value;
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nenhum campo informado" };
  return { ok: true, fields: out };
}

/** Lê um objeto num caminho `a.b.0.c` do dataJson (sem criar nada). */
export function getAtPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Devolve uma cópia do dataJson com `fields` aplicados na parte em `path`
 * (objeto criado quando ausente — caso dos cônjuges). `""` remove a chave.
 * Nunca muta a entrada.
 */
export function applyPartyFields(
  root: Record<string, unknown>,
  path: string,
  fields: Record<string, string | number | boolean>
): Record<string, unknown> {
  const segs = path.split(".");
  // Cópia rasa só ao longo do caminho: o resto do dataJson é compartilhado
  // (imutável por convenção), então nada fora da parte alvo é reescrito.
  const shallow = (v: unknown): Record<string, unknown> | unknown[] =>
    Array.isArray(v) ? [...v] : { ...((v && typeof v === "object" ? v : {}) as Record<string, unknown>) };
  const out = shallow(root) as Record<string, unknown>;
  let cur: unknown = out;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const holder = cur as Record<string, unknown>;
    const existing: unknown = Array.isArray(cur) ? cur[Number(seg)] : holder[seg];
    const next = shallow(existing);
    if (Array.isArray(cur)) cur[Number(seg)] = next;
    else holder[seg] = next;
    cur = next;
  }
  const target = cur as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") delete target[k];
    else target[k] = v;
  }
  return out;
}

export { basePathForTarget };
