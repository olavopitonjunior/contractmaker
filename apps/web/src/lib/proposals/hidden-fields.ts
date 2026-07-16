/**
 * ALLOWLIST dos campos que podem ser ocultados na via reduzida (a que o
 * proprietário/locador assina).
 *
 * Por que allowlist e não dot-path livre do cliente:
 *  1. Segurança — `hiddenPaths` acaba num `where`/render server-side; aceitar
 *     path arbitrário é injeção de leitura.
 *  2. Integridade do template — esconder um campo no meio de uma frase
 *     ("comissão de {{X}}% sobre o valor") quebra o Handlebars. Cada path aqui
 *     corresponde a um bloco `{{#if}}` inteiro no template, não a um valor solto.
 *
 * A chave do mapa é o `schemaType` da proposta. O valor é a lista de campos
 * ocultáveis, com o dot-path real no dataJson e um rótulo pra UI.
 */

export interface HideableField {
  /** Dot-path no dataJson. Suporta índice de array: `compradores.0.renda`. */
  path: string;
  /** Rótulo curto pra checkbox na tela. */
  label: string;
}

const VENDA_HIDEABLE: HideableField[] = [
  { path: "comissao", label: "Comissão da imobiliária" },
  { path: "compradores.0.renda", label: "Renda do proponente" },
  { path: "config.limite_autorizado", label: "Limite autorizado pelo comprador" },
  { path: "config.condicoes_internas", label: "Condições internas / observações" },
];

const LOCACAO_HIDEABLE: HideableField[] = [
  { path: "comissao", label: "Comissão da imobiliária" },
  { path: "locatarios.0.renda", label: "Renda do proponente" },
  { path: "config.condicoes_internas", label: "Condições internas / observações" },
];

const HIDEABLE_BY_SCHEMA: Record<string, HideableField[]> = {
  compra_venda_v1: VENDA_HIDEABLE,
  locacao_residencial_v1: LOCACAO_HIDEABLE,
  locacao_comercial_v1: LOCACAO_HIDEABLE,
};

/** Campos ocultáveis oferecidos na UI para um schemaType. */
export function hideableFieldsFor(schemaType: string): HideableField[] {
  return HIDEABLE_BY_SCHEMA[schemaType] ?? [];
}

/**
 * Filtra `hiddenPaths` recebidos do cliente, mantendo só os que estão na
 * allowlist do schemaType. Silenciosamente descarta qualquer path não previsto.
 */
export function sanitizeHiddenPaths(
  schemaType: string,
  requested: string[]
): string[] {
  const allowed = new Set(hideableFieldsFor(schemaType).map((f) => f.path));
  return requested.filter((p) => allowed.has(p));
}

/** `true` se algum path oculto é (ou começa por) o bloco de comissão. */
export function hidesComissao(hiddenPaths: string[]): boolean {
  return hiddenPaths.some((p) => p === "comissao" || p.startsWith("comissao."));
}
