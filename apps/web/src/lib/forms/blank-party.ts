import { isValueEmpty } from "./party-required";

/**
 * Detecção de "parte template-vazia" — o cinto server-side contra o eco de
 * template do auto-save.
 *
 * Cenário real (prod 2026-07-23): participante grava `vendedores[0]` pelo link
 * individual; uma aba do form principal hidratada ANTES disso auto-salva o
 * estado inteiro e — como arrays substituem inteiros no merge — regrava
 * `vendedores` com o template vazio de defaultFormValues, apagando a parte.
 * O fix raiz é o cliente escopar o auto-save por dirty-keys; este módulo é a
 * segunda camada: um array recebido que é 100% template-vazio nunca pode
 * sobrescrever um array que já tem gente de verdade.
 *
 * Trade-off assumido: "limpar TODOS os identificadores de TODAS as partes de
 * propósito" deixa de persistir (raro; auditado via FORM_PATCH_BLANK_ARRAY_
 * SKIPPED). Remover partes pelo botão (array menor ou `[]`) continua passando.
 */

/**
 * Campos que identificam uma pessoa no form. Se TODOS estão vazios, a parte é
 * indistinguível do template do wizard — defaults como `tipo_pessoa`,
 * `nacionalidade` e booleans não contam, e sub-objetos (conjuge, recebimento,
 * procurador) vazios também não.
 */
export const PARTY_IDENTIFIER_FIELDS = [
  "nome",
  "cpf",
  "cnpj",
  "razao_social",
  "email",
  "rg",
] as const;

/** Chaves top-level de arrays de partes nas duas esteiras (venda + locação). */
export const PARTY_ARRAY_KEYS = [
  "vendedores",
  "compradores",
  "locadores",
  "locatarios",
] as const;

function isEmptyIdentifier(raw: unknown): boolean {
  if (typeof raw === "string") return raw.trim() === "";
  return isValueEmpty(raw);
}

/** Parte template-vazia: plain object com todos os identificadores vazios. */
export function isBlankParty(party: unknown): boolean {
  if (typeof party !== "object" || party === null || Array.isArray(party)) {
    return false;
  }
  const record = party as Record<string, unknown>;
  return PARTY_IDENTIFIER_FIELDS.every((field) =>
    isEmptyIdentifier(record[field]),
  );
}

/**
 * true sse `value` é array NÃO-vazio composto 100% de partes template-vazias.
 * `[]` retorna false — remoção total é intenção legítima e nunca é eco de
 * template (o template do wizard sempre tem >= 1 parte).
 */
export function isAllBlankPartyArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isBlankParty)
  );
}

export interface BlankArrayFilterResult {
  /** Cópia rasa de `incoming` sem as chaves descartadas. */
  incoming: Record<string, unknown>;
  skippedKeys: string[];
}

/**
 * Para cada chave protegida: descarta `incoming[key]` quando o incoming é
 * all-blank E `current[key]` tem pelo menos uma parte com conteúdo. Qualquer
 * outro shape (não-array, parcialmente preenchido, current vazio/ausente —
 * primeiro save de form novo) passa intacto.
 */
export function filterBlankPartyArrays(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  protectedKeys: readonly string[],
): BlankArrayFilterResult {
  const skippedKeys: string[] = [];
  for (const key of protectedKeys) {
    if (!(key in incoming)) continue;
    if (!isAllBlankPartyArray(incoming[key])) continue;
    const currentVal = current[key];
    const currentHasContent =
      Array.isArray(currentVal) && currentVal.some((p) => !isBlankParty(p));
    if (currentHasContent) skippedKeys.push(key);
  }
  if (skippedKeys.length === 0) return { incoming, skippedKeys };
  const filtered = { ...incoming };
  for (const key of skippedKeys) delete filtered[key];
  return { incoming: filtered, skippedKeys };
}
