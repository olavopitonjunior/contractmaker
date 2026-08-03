/**
 * Normalização de texto pra busca insensível a acento/caixa — "joão" acha
 * "Joao" e vice-versa. Regex PT-BR com `\b` falha após vogal acentuada;
 * comparar strings normalizadas evita a armadilha inteira.
 */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
