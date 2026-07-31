/**
 * Escopo de leitura da base de conhecimento.
 *
 * Desde o RAG global, `KnowledgeItem` vive em DOIS escopos:
 *   - `orgId = <id>`  → base do tenant;
 *   - `orgId IS NULL` → base da PLATAFORMA, visível a todos.
 *
 * Este módulo é o ÚNICO lugar que sabe combinar os dois. Todo site de leitura
 * (Prisma ou SQL cru do pgvector) passa por aqui — um `where: { orgId }` solto
 * em qualquer query volta a esconder a base universal, e o inverso (esquecer o
 * filtro) vaza conteúdo de um tenant pra outro. Por isso as duas formas moram
 * no mesmo arquivo e são testadas juntas.
 *
 * Escrita NÃO passa por aqui: continua sempre org-scoped, e linha de plataforma
 * exige super_admin (ver `assertPlatformWriteAllowed`).
 */

import type { AgentKey } from "./agents/registry";
import type { RagScope } from "./agents/resolve";

export interface KnowledgeScopeOptions {
  /** Filtra por `visibleToAgents` (array vazio na linha = visível a todos). */
  agentKey?: AgentKey | null;
  /** `AgentProfile.ragScope` — restringe categorias/tags e pode cortar a plataforma. */
  ragScope?: RagScope | null;
}

/**
 * Categorias que vivem na plataforma mas NÃO pertencem ao RAG jurídico.
 *
 * `support` é a base do assistente de "como usar o produto" — 37 itens do tipo
 * "o que faz a tela Pipeline". Enquanto morava numa org-sentinela ela só
 * poluía aquela org; ao virar plataforma passaria a aparecer na busca de
 * cláusulas de TODO tenant, e na aba Base de Conhecimento deles. Quem lê essa
 * base (`lib/support/knowledge.ts`, `/api/admin/support/*`) consulta por
 * `category` explícita e não passa por aqui.
 */
const NAO_JURIDICAS = ["support"];

/** `ragScope.includePlatform` default é TRUE: ninguém perde a base universal por omissão. */
function includesPlatform(opts: KnowledgeScopeOptions): boolean {
  return opts.ragScope?.includePlatform !== false;
}

function nonEmpty(v: string[] | undefined | null): string[] | null {
  return Array.isArray(v) && v.length > 0 ? v : null;
}

/**
 * Fragmento `where` do Prisma com o escopo de leitura.
 *
 * @param orgId `null` = consulta SÓ a plataforma (é o que o /admin usa).
 *
 * Devolve um objeto pronto pra espalhar dentro de um `where` maior. Usa `AND`
 * explícito porque os filtros são independentes e cada um pode precisar do seu
 * próprio `OR` — espalhar dois `OR` no mesmo nível faria o segundo sobrescrever
 * o primeiro em silêncio, que é o tipo de bug que não aparece em teste feliz.
 */
export function knowledgeScopeWhere(
  orgId: string | null,
  opts: KnowledgeScopeOptions = {}
): Record<string, unknown> {
  // Dentro do AND, não solto no objeto: um `category` que o caller espalhe ao
  // lado do resultado sobrescreveria uma chave de mesmo nome no nível de cima.
  const and: Record<string, unknown>[] = [
    { category: { notIn: NAO_JURIDICAS } },
  ];

  if (orgId === null) {
    and.push({ orgId: null });
  } else if (includesPlatform(opts)) {
    and.push({ OR: [{ orgId }, { orgId: null }] });
  } else {
    and.push({ orgId });
  }

  if (opts.agentKey) {
    and.push({
      OR: [
        { visibleToAgents: { isEmpty: true } },
        { visibleToAgents: { has: opts.agentKey } },
      ],
    });
  }

  const categories = nonEmpty(opts.ragScope?.categories);
  if (categories) and.push({ category: { in: categories } });

  const tags = nonEmpty(opts.ragScope?.tags);
  if (tags) and.push({ tags: { hasSome: tags } });

  return { AND: and };
}

export interface ScopeSql {
  /** Condições já prefixadas com `AND `, prontas pra concatenar num WHERE. */
  sql: string;
  params: unknown[];
  /** Próximo `$n` livre, pro caller continuar numerando. */
  nextParamIndex: number;
}

/**
 * Mesmo escopo, em SQL cru — o pgvector não passa pelo query builder do Prisma
 * (`embedding` não existe no schema), então a busca semântica precisa da versão
 * textual. Parametrizado: nada de interpolar valor em string.
 */
export function knowledgeScopeSql(
  orgId: string | null,
  opts: KnowledgeScopeOptions = {},
  startParamIndex = 1
): ScopeSql {
  const parts: string[] = [`category <> ALL($${startParamIndex}::text[])`];
  const params: unknown[] = [NAO_JURIDICAS];
  let i = startParamIndex + 1;

  if (orgId === null) {
    parts.push(`"orgId" IS NULL`);
  } else if (includesPlatform(opts)) {
    parts.push(`("orgId" = $${i++} OR "orgId" IS NULL)`);
    params.push(orgId);
  } else {
    parts.push(`"orgId" = $${i++}`);
    params.push(orgId);
  }

  if (opts.agentKey) {
    parts.push(
      `(cardinality("visibleToAgents") = 0 OR "visibleToAgents" @> ARRAY[$${i++}]::text[])`
    );
    params.push(opts.agentKey);
  }

  const categories = nonEmpty(opts.ragScope?.categories);
  if (categories) {
    parts.push(`category = ANY($${i++}::text[])`);
    params.push(categories);
  }

  const tags = nonEmpty(opts.ragScope?.tags);
  if (tags) {
    parts.push(`tags && $${i++}::text[]`);
    params.push(tags);
  }

  return {
    sql: parts.map((p) => `AND ${p}`).join("\n        "),
    params,
    nextParamIndex: i,
  };
}

/**
 * Desempate: com similaridade IGUAL, o item do tenant vem antes do da plataforma.
 *
 * É só desempate, de propósito. Empurrar o tenant pra frente de um item de
 * plataforma MAIS similar regrediria o recall — o mesmo erro que o piso de
 * similaridade já tinha custado uma vez (ver o comentário longo em
 * `handleQueryKnowledgeBase`): quem busca RAG quer o melhor conteúdo, e a
 * sobreposição real é entre textos quase idênticos, que empatam de fato.
 */
export const TENANT_FIRST_ORDER_BY = `"orgId" NULLS LAST`;

/** A linha é da base de plataforma? */
export function isPlatformItem(item: { orgId: string | null }): boolean {
  return item.orgId === null;
}
