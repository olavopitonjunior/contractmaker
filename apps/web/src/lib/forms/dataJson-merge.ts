/**
 * Deep-merge restrito para `SalesForm.dataJson` PATCHes.
 *
 * Substitui o `{ ...current, ...incoming }` raso que vinha sendo usado em
 * `api/forms/[token]/route.ts`. Problemas que o spread raso causa quando
 * dois clientes (subtoken vendedor + subtoken comprador, PR 4) escrevem em
 * paralelo: a última requisição vence chaves nunca tocadas (`pagamento`,
 * `comissao`), zerando o trabalho do outro. Auto-save concorrente em raízes
 * disjuntas precisa preservar tudo que não veio no payload.
 *
 * Semântica:
 * - Plain objects (vendedores não é object — é array): merge recursivo.
 * - Arrays: substituem inteiros. O usuário pode REMOVER itens (remove o 2º
 *   comprador), e o array de tamanho menor precisa virar o novo estado.
 * - `undefined` / `null` em `incoming`: NÃO apaga a chave existente.
 *   Auto-save manda o estado todo do RHF; campos não-tocados podem vir
 *   undefined depois de serialização — não devem zerar dados reais.
 * - `allowedTopKeys`: se definido, chaves em `incoming` fora dessa lista
 *   são descartadas e ranqueadas em `rejectedPaths`. Usado por subtokens
 *   pra travar escopo (vendedor não pode escrever em `compradores`).
 *   Não retornamos 403 — bug de UI não deve quebrar auto-save. O caller
 *   decide se loga em audit.
 */

export interface DeepMergeResult {
  merged: Record<string, unknown>;
  rejectedPaths: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMergeAtPaths(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  allowedTopKeys?: readonly string[],
): DeepMergeResult {
  const merged: Record<string, unknown> = { ...current };
  const rejectedPaths: string[] = [];
  const allow = allowedTopKeys ? new Set(allowedTopKeys) : null;

  for (const key of Object.keys(incoming)) {
    if (allow && !allow.has(key)) {
      rejectedPaths.push(key);
      continue;
    }

    const incomingVal = incoming[key];
    if (incomingVal === undefined || incomingVal === null) {
      continue;
    }

    const currentVal = merged[key];
    if (isPlainObject(currentVal) && isPlainObject(incomingVal)) {
      const sub = deepMergeAtPaths(currentVal, incomingVal);
      merged[key] = sub.merged;
      for (const r of sub.rejectedPaths) {
        rejectedPaths.push(`${key}.${r}`);
      }
    } else {
      merged[key] = incomingVal;
    }
  }

  return { merged, rejectedPaths };
}
