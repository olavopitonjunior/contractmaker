/**
 * Regras de FORMATO dos campos do formulário público (2026-06-01).
 *
 * Princípio (decisão do produto): validar formato SÓ quando o campo tem algum
 * valor. Campo vazio + opcional NÃO bloqueia (o cliente preenche o form em
 * etapas). Campo preenchido com formato inválido bloqueia o avanço/finalize.
 *
 * Cada `*Rule` segue a convenção do react-hook-form `validate`:
 *   - retorna `true`  → ok (vazio OU formato válido)
 *   - retorna string  → mensagem de erro (preenchido + formato inválido)
 *
 * As mesmas funções alimentam o schema do servidor (validation.ts) e o wizard
 * do cliente (SalesFormWizard), pra a regra ser única e idêntica nos dois lados.
 */
import { validateCPF, validateCNPJ } from "@/lib/ai/validators";

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || String(v).trim() === "";

const onlyDigits = (v: string): string => v.replace(/\D/g, "");

// 27 unidades federativas (26 estados + DF).
const UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

// -------------------------------------------------------------------
// Predicados puros (true = válido). NÃO consideram "vazio" — quem decide se
// vazio passa são as *Rule abaixo (gate isBlank).
// -------------------------------------------------------------------

export function isValidCPF(v: string): boolean {
  return validateCPF(v);
}

export function isValidCNPJ(v: string): boolean {
  return validateCNPJ(v);
}

/**
 * Nome "completo": ao menos 2 tokens com 2+ letras (nome + sobrenome).
 * Pega "OTILIA" sozinho; NÃO pega "OTILIA DA GLORIA" (3 tokens) — limite
 * conhecido: formato não detecta nome completo-porém-divergente da Receita.
 */
export function isFullName(v: string): boolean {
  const tokens = v
    .trim()
    .split(/\s+/)
    .filter((t) => /[\p{L}]{2,}/u.test(t));
  return tokens.length >= 2;
}

export function isValidCEP(v: string): boolean {
  return onlyDigits(v).length === 8;
}

export function isValidUF(v: string): boolean {
  return UFS.has(v.trim().toUpperCase());
}

/** Telefone BR: 10 (fixo) ou 11 (celular) dígitos, com DDD. */
export function isValidPhoneBR(v: string): boolean {
  const d = onlyDigits(v);
  return d.length === 10 || d.length === 11;
}

/**
 * Data de nascimento. Aceita ISO (YYYY-MM-DD, do input type=date) ou
 * DD/MM/AAAA (OCR/colado). Precisa ser calendário válido, ano ≥ 1900 e não
 * pode estar no futuro. `today` injetável pra teste determinístico.
 */
export function isValidBirthdate(v: string, today: Date = new Date()): boolean {
  const s = v.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (br) {
    d = +br[1]; m = +br[2]; y = +br[3];
  } else {
    return false;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 1900) return false;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  // Rejeita overflow (ex.: 31/02 vira 03/03).
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return false;
  }
  if (dt.getTime() > today.getTime()) return false;
  return true;
}

// -------------------------------------------------------------------
// Rules estilo react-hook-form: vazio passa; preenchido valida.
// -------------------------------------------------------------------

type Rule = (v: unknown) => true | string;

const rule =
  (predicate: (s: string) => boolean, message: string): Rule =>
  (v: unknown) =>
    isBlank(v) || predicate(String(v)) ? true : message;

export const cpfRule = rule(isValidCPF, "CPF inválido — confira os dígitos");
export const cnpjRule = rule(isValidCNPJ, "CNPJ inválido — confira os dígitos");
export const nomeCompletoRule = rule(
  isFullName,
  "Informe o nome completo (nome e sobrenome)"
);
export const nomeMaeRule = rule(
  isFullName,
  "Informe o nome completo da mãe (nome e sobrenome)"
);
export const cepRule = rule(isValidCEP, "CEP deve ter 8 dígitos");
export const ufRule = rule(isValidUF, "UF inválida");
export const telefoneRule = rule(
  isValidPhoneBR,
  "Telefone deve ter DDD + número (10 ou 11 dígitos)"
);
export const dataNascimentoRule = rule(
  (s) => isValidBirthdate(s),
  "Data de nascimento inválida (use DD/MM/AAAA, não pode ser futura)"
);

// -------------------------------------------------------------------
// Máscaras (format-as-you-type). Retornam o valor formatado.
// -------------------------------------------------------------------

export function maskCPF(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

export function maskCNPJ(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

export function maskCEP(v: string): string {
  const d = onlyDigits(v).slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}

export function maskTelefone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/^\((\d{2})\) (\d{4})(\d)/, "($1) $2-$3");
  }
  return d
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/^\((\d{2})\) (\d{5})(\d)/, "($1) $2-$3");
}

/**
 * Coleta problemas de formato de UMA parte (PF ou PJ) para o servidor.
 * Caminhos relativos ao objeto da parte (ex.: "cpf", "conjuge.nome_mae").
 * Só inclui campos preenchidos com formato inválido.
 */
export function collectPartyFormatIssues(
  parte: Record<string, unknown> | null | undefined
): Array<{ path: string; message: string }> {
  if (!parte) return [];
  const issues: Array<{ path: string; message: string }> = [];
  const check = (path: string, value: unknown, r: Rule) => {
    const res = r(value);
    if (res !== true) issues.push({ path, message: res });
  };

  const isPJ = parte.tipo_pessoa === "juridica";
  if (isPJ) {
    check("cnpj", parte.cnpj, cnpjRule);
    check("razao_social", parte.razao_social, nomeCompletoRule);
  } else {
    check("nome", parte.nome, nomeCompletoRule);
    check("cpf", parte.cpf, cpfRule);
    check("nome_mae", parte.nome_mae, nomeMaeRule);
    check("data_nascimento", parte.data_nascimento, dataNascimentoRule);
  }
  check("cep", parte.cep, cepRule);
  if (!isBlank(parte.uf)) check("uf", parte.uf, ufRule);
  check("mobile_phone", parte.mobile_phone, telefoneRule);

  // Sub-pessoas que viram diligência (mesmas regras de PF).
  const sub: Array<[string, unknown]> = [
    ["conjuge", parte.conjuge],
    ["procurador", parte.procurador],
    ["representante", parte.representante],
  ];
  for (const [key, obj] of sub) {
    if (!obj || typeof obj !== "object") continue;
    const p = obj as Record<string, unknown>;
    check(`${key}.nome`, p.nome, nomeCompletoRule);
    check(`${key}.cpf`, p.cpf, cpfRule);
    check(`${key}.nome_mae`, p.nome_mae, nomeMaeRule);
    check(`${key}.data_nascimento`, p.data_nascimento, dataNascimentoRule);
    check(`${key}.mobile_phone`, p.mobile_phone, telefoneRule);
  }
  return issues;
}
