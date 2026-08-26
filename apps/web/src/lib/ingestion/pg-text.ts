/**
 * Saneamento do que atravessa a fronteira do banco.
 *
 * O Postgres recusa o byte NUL em `text` e em `jsonb` — a gravação inteira
 * falha com 22P05 ("unsupported Unicode escape sequence"). E NUL não é
 * hipótese remota aqui: o pipeline grava texto extraído de DOCX e PDF, que vem
 * de arquivo de terceiro, mais planos e relatórios montados a partir dele.
 *
 * Isto existe porque a correção pontual não basta. Já tivemos NUL chegando por
 * uma chave composta que usava NUL como separador; o próximo virá do conteúdo
 * de um documento, e o sintoma é sempre o mesmo: o run morre numa escrita, em
 * geral depois de trabalho caro (classificação, plano, revisão humana). O
 * lugar de resolver é a borda de escrita, não cada chamador.
 *
 * Só o NUL é removido. Os demais caracteres de controle o Postgres aceita, e
 * apagá-los mudaria texto legítimo de contrato (quebra de linha, tabulação).
 */

const NUL = String.fromCharCode(0);

/** Remove NUL de uma string. Devolve a mesma referência quando não há nada a fazer. */
export function stripNulString<T extends string | null | undefined>(value: T): T {
  if (typeof value !== "string" || !value.includes(NUL)) return value;
  return value.split(NUL).join("") as T;
}

/**
 * Remove NUL recursivamente de qualquer valor que vá para uma coluna `jsonb`
 * — inclusive das CHAVES de objeto, que também são texto para o Postgres.
 */
export function stripNulDeep<T>(value: T): T {
  if (typeof value === "string") return stripNulString(value) as T;
  if (Array.isArray(value)) return value.map(stripNulDeep) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[stripNulString(k)] = stripNulDeep(v);
    }
    return out as T;
  }
  return value;
}
