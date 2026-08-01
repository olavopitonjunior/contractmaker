/**
 * Knowledge base helpers: create, update, delete items with embeddings.
 *
 * The `embedding` column is not part of the Prisma schema (pgvector is raw SQL),
 * so these helpers wrap Prisma create/update with additional $executeRaw calls
 * that set the vector via pgvector literal syntax.
 */

import { prisma } from "@/lib/db/prisma";
import { embed, toPgVector, isEmbeddingsConfigured } from "./embeddings";
import { chunkText } from "./chunking";

export type KnowledgeCategory =
  | "legislation"
  | "model"
  | "rule"
  | "glossary"
  | "clause"
  // Base de conhecimento do assistente de suporte (plataforma). Ver lib/support/*.
  | "support";

export interface CreateKnowledgeItemInput {
  /** `null` = base de PLATAFORMA. Exige `allowPlatformScope` — ver `assertScopeAllowed`. */
  orgId: string | null;
  /**
   * Confirma que o caller é super_admin e QUER escrever na base de plataforma.
   *
   * Existe porque `orgId` virou nullable: sem este opt-in, um `orgId` que chega
   * undefined por um bug de resolução de sessão deixaria de ser erro e viraria
   * escrita silenciosa na base que todos os tenants leem. Com ele, escrever na
   * plataforma é sempre uma decisão explícita e grep-ável.
   */
  allowPlatformScope?: boolean;
  /**
   * Agentes que enxergam o item. Vazio/ausente = todos.
   *
   * A base de suporte usa isto pra não vazar pro RAG jurídico: "o que faz a
   * tela Pipeline" não é resposta pra busca de cláusula. O filtro por categoria
   * em `knowledge-scope.ts` já cobre a leitura; marcar na linha mantém o dado
   * autoexplicativo pra quem for ler o banco depois.
   */
  visibleToAgents?: string[];
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags?: string[];
  source?: string;
  createdBy?: string | null;
  // Fields que só fazem sentido quando category === "clause".
  // Ignorados pra outras categorias.
  agentNotes?: string | null;
  groupCode?: string | null;
  subcategory?: string | null;
  isVariable?: boolean;
  status?: string;
  usageCount?: number;
  /**
   * Grava UMA row com o `content` INTEGRAL, sem repartir em chunks.
   *
   * Chunkar é ótimo pra RAG (o vetor precisa caber na janela do Voyage) e
   * PÉSSIMO pra conteúdo que é LIDO DE VOLTA inteiro. Uma cláusula de slot é o
   * segundo caso: `resolveClauseSlots` pega UMA linha por tag e injeta o
   * `content` dela no contrato. Com chunking, uma cláusula de 6.6k chars virava
   * um parent com `content = slice(0, 500)` (um preview cortado no meio da
   * frase) + N filhas que herdam as MESMAS tags e nascem `approved` — e o
   * contrato saía com o preview ou com um pedaço do meio.
   *
   * Default: ligado automaticamente quando as tags marcam um slot (`slot:*`).
   * A coluna é `@db.Text`, então 6.6k chars cabem sem drama. O EMBEDDING (se
   * rodar) continua usando o texto truncado no 1º chunk — o vetor é aproximação
   * pra busca, o `content` é o que vira contrato.
   */
  noChunk?: boolean;
}

/**
 * Prefixo da tag que marca a cláusula como conteúdo de um slot de template.
 *
 * Cópia deliberada de `SLOT_TAG_PREFIX` (lib/templates/clause-slots.ts) em vez
 * de import: este módulo é caminho quente de toda API de KB e importar de lá
 * arrastaria junto o Handlebars do render. A paridade entre os dois é travada
 * por teste em `lib/templates/__tests__/clause-slots.test.ts`.
 */
export const SLOT_CLAUSE_TAG_PREFIX = "slot:";

/** Tags marcam uma cláusula de slot? (→ nunca chunkar: ela é lida inteira). */
export function isSlotClauseTags(tags: string[] | undefined | null): boolean {
  return (tags ?? []).some((t) => t.startsWith(SLOT_CLAUSE_TAG_PREFIX));
}

/**
 * Mesma limpeza que `chunkText` aplica antes de repartir. Existe pra que a row
 * `noChunk` guarde EXATAMENTE o que o caminho chunkado guardaria num conteúdo
 * curto — sem isso, um `\r\n` faria o seed "atualizar" a mesma cláusula em toda
 * rodada.
 */
export function normalizeKnowledgeContent(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * Barra escrita na base de plataforma que não foi pedida explicitamente.
 * O controle de PERMISSÃO (super_admin) é da rota — `requirePlatform`; este
 * guard só garante que ninguém chegue em `orgId = null` por acidente.
 */
export function assertScopeAllowed(
  orgId: string | null,
  allowPlatformScope: boolean | undefined,
  op: string
): void {
  if (orgId === null && !allowPlatformScope) {
    throw new Error(
      `[knowledge] ${op} com orgId nulo sem allowPlatformScope — escrita na base de plataforma precisa ser explícita.`
    );
  }
}

/**
 * Alvo não existe DENTRO do escopo pedido. Classe própria pra rota responder
 * 404: antes o `Error` genérico caía no catch-all e virava 500 "Erro ao
 * atualizar", o que confunde ausência com falha do servidor.
 */
export class KnowledgeItemNotFoundError extends Error {
  constructor() {
    super("Item não encontrado");
    this.name = "KnowledgeItemNotFoundError";
  }
}

/**
 * Restringe a escrita a UMA categoria.
 *
 * `orgId` sozinho parou de ser escopo suficiente quando `orgId = NULL` virou
 * "a base que todos leem": as rotas de /admin/support/* são gateadas em
 * `PlatformRole = "support"` e escrevem com orgId nulo, então sem esta trava
 * elas alcançariam também `legislation`/`clause`/`rule` — justamente o que
 * /api/admin/knowledge reservou ao `super_admin`. Quem escreve numa base
 * específica declara qual é.
 */
export interface KnowledgeScopeGuard {
  scopeCategory?: KnowledgeCategory;
}

function scopeCategoryWhere(opts: KnowledgeScopeGuard) {
  return opts.scopeCategory ? { category: opts.scopeCategory } : {};
}

export interface KnowledgeItemRow {
  id: string;
  orgId: string | null;
  category: string;
  title: string;
  content: string;
  chunkIndex: number;
  chunkTotal: number;
  parentId: string | null;
  tags: string[];
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function clauseExtras(input: CreateKnowledgeItemInput) {
  if (input.category !== "clause") return {};
  return {
    agentNotes: input.agentNotes ?? null,
    groupCode: input.groupCode ?? null,
    subcategory: input.subcategory ?? null,
    isVariable: input.isVariable ?? false,
    status: input.status ?? "approved",
    usageCount: input.usageCount ?? 0,
  };
}

/** Linha que precisa de embedding + o texto (título + conteúdo) a embutir. */
export interface EmbedTarget {
  id: string;
  text: string;
}

/**
 * Superfície mínima do Prisma que a criação de linhas usa. Existe pro caller
 * passar o `tx` de uma transação interativa (`prisma.$transaction`) e ingerir N
 * itens de forma atômica — sem isso, uma falha no meio do loop deixava as
 * primeiras linhas órfãs (sem embedding) e o retry duplicava.
 *
 * `any` nos args porque a assinatura genérica do PrismaClient não é atribuível
 * a um parâmetro tipado (contravariância) — mesmo padrão de
 * `lib/templates/upload-dedup.ts`.
 */
export type KnowledgeWriteClient = {
  knowledgeItem: {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    create: (args: any) => Promise<any>;
  };
};

/**
 * Cria as linhas do knowledge item **sem** gerar embeddings — retorna os alvos
 * de embedding pro caller decidir quando embutir (síncrono via
 * `createKnowledgeItem`, ou em background via `waitUntil(embedKnowledgeItem(...))`
 * num endpoint de upload, onde a chamada ao Voyage não pode segurar a resposta).
 *
 * Mantém a semântica original: single-chunk embute a própria linha; multi-chunk
 * cria um parent-resumo (não embutido) + linhas-filhas embutidas.
 *
 * `db` permite passar o `tx` de uma transação interativa — é como o upload de
 * uma coleção de cláusulas cria os N itens tudo-ou-nada.
 */
export async function createKnowledgeItemRows(
  input: CreateKnowledgeItemInput,
  db: KnowledgeWriteClient = prisma
): Promise<{ parentId: string; embedTargets: EmbedTarget[] }> {
  assertScopeAllowed(input.orgId, input.allowPlatformScope, "create");
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    throw new Error("Conteúdo vazio após limpeza");
  }

  const extras = clauseExtras(input);

  // Cláusula de slot nunca é chunkada: ela é lida de volta INTEIRA pra dentro
  // do contrato (ver `noChunk` em CreateKnowledgeItemInput).
  const noChunk = input.noChunk ?? isSlotClauseTags(input.tags);

  // Short path: single chunk = single row (no parent/children split)
  if (noChunk || chunks.length === 1) {
    const parent = await db.knowledgeItem.create({
      data: {
        orgId: input.orgId,
        category: input.category,
        title: input.title,
        // `noChunk` persiste o texto inteiro; sem ele, o único chunk (que num
        // conteúdo curto é o mesmo texto limpo).
        content: noChunk ? normalizeKnowledgeContent(input.content) : chunks[0].text,
        chunkIndex: 0,
        chunkTotal: 1,
        parentId: null,
        tags: input.tags ?? [],
        source: input.source ?? "manual",
        createdBy: input.createdBy ?? null,
        visibleToAgents: input.visibleToAgents ?? [],
        ...extras,
      },
    });
    return {
      parentId: parent.id,
      // O VETOR usa só o 1º chunk quando o texto passa da janela do Voyage —
      // truncar a busca é aceitável, truncar o contrato não.
      embedTargets: [{ id: parent.id, text: `${input.title}\n\n${chunks[0].text}` }],
    };
  }

  // Multi-chunk path: create parent row, then chunk rows linked to parent
  const parent = await db.knowledgeItem.create({
    data: {
      orgId: input.orgId,
      category: input.category,
      title: input.title,
      content: input.content.slice(0, 500), // parent keeps a summary preview
      chunkIndex: 0,
      chunkTotal: chunks.length,
      parentId: null,
      tags: input.tags ?? [],
      source: input.source ?? "manual",
      createdBy: input.createdBy ?? null,
      visibleToAgents: input.visibleToAgents ?? [],
      ...extras,
    },
  });

  const chunkRows = await Promise.all(
    chunks.map((chunk) =>
      db.knowledgeItem.create({
        data: {
          orgId: input.orgId,
          category: input.category,
          title: `${input.title} (parte ${chunk.index + 1}/${chunk.total})`,
          content: chunk.text,
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
          parentId: parent.id,
          tags: input.tags ?? [],
          source: input.source ?? "manual",
          createdBy: input.createdBy ?? null,
          // Chunk herda a visibilidade do pai — senão a busca semântica, que só
          // vê as filhas, ignoraria a restrição.
          visibleToAgents: input.visibleToAgents ?? [],
        },
      })
    )
  );

  // Só as linhas-filhas são embutidas (o parent multi-chunk é só um resumo).
  const embedTargets = chunkRows.map((row, i) => ({
    id: row.id,
    text: `${input.title}\n\n${chunks[i].text}`,
  }));
  return { parentId: parent.id, embedTargets };
}

/**
 * Gera embeddings (batch único, minimiza custo) e grava os vetores pgvector.
 * No-op quando o Voyage não está configurado — as linhas seguem pesquisáveis
 * via ILIKE. Best-effort: seguro chamar de `waitUntil`.
 */
export async function embedKnowledgeItem(
  targets: EmbedTarget[],
  ctx: { orgId: string | null; userId?: string | null }
): Promise<void> {
  if (!isEmbeddingsConfigured() || targets.length === 0) return;
  // Item de plataforma registra com `orgId: null` — é custo real, só que de
  // ninguém em particular. Antes ficava sem registro nenhum, e com a ingestão
  // em lote na plataforma isso deixaria de ser "um punhado de itens à mão".
  const vectors = await embed(targets.map((t) => t.text), "document", {
    orgId: ctx.orgId,
    userId: ctx.userId,
    operation: "embed_kb",
  });
  for (let i = 0; i < targets.length; i++) {
    await prisma.$executeRawUnsafe(
      `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
      toPgVector(vectors[i]),
      targets[i].id
    );
  }
}

/**
 * Create a knowledge item (rows + embeddings, síncrono). Wrapper sobre
 * `createKnowledgeItemRows` + `embedKnowledgeItem` — mantido pros callers que
 * querem o embedding concluído dentro do request (ex.: criação por texto colado).
 */
export async function createKnowledgeItem(
  input: CreateKnowledgeItemInput
): Promise<{ parentId: string; chunksCreated: number }> {
  const { parentId, embedTargets } = await createKnowledgeItemRows(input);
  await embedKnowledgeItem(embedTargets, {
    orgId: input.orgId,
    userId: input.createdBy,
  });
  return { parentId, chunksCreated: embedTargets.length };
}

/**
 * Update a knowledge item. If content changed, re-embed.
 */
export async function updateKnowledgeItem(
  id: string,
  orgId: string | null,
  patch: Partial<Omit<CreateKnowledgeItemInput, "orgId" | "category">> & {
    allowPlatformScope?: boolean;
  },
  opts: KnowledgeScopeGuard = {}
): Promise<void> {
  assertScopeAllowed(orgId, patch.allowPlatformScope, "update");
  // `orgId` aqui é o do USUÁRIO, não o da linha — é ele que impede escrita
  // cross-org, e agora também impede o tenant de editar item de plataforma
  // (`orgId = "abc"` não casa com a linha `orgId = NULL`).
  const current = await prisma.knowledgeItem.findFirst({
    where: { id, orgId, ...scopeCategoryWhere(opts) },
  });
  if (!current) throw new KnowledgeItemNotFoundError();

  const contentChanged =
    typeof patch.content === "string" && patch.content !== current.content;

  // Patches específicos de clause só aplicam se a row já é category="clause"
  // OU se o caller está explicitamente migrando uma row pra clause (não acontece
  // hoje — todas as conversões saem de createKnowledgeItem).
  const clausePatch = current.category === "clause"
    ? {
        agentNotes: patch.agentNotes !== undefined ? patch.agentNotes : current.agentNotes,
        groupCode: patch.groupCode !== undefined ? patch.groupCode : current.groupCode,
        subcategory: patch.subcategory !== undefined ? patch.subcategory : current.subcategory,
        isVariable: patch.isVariable !== undefined ? patch.isVariable : current.isVariable,
        status: patch.status !== undefined ? patch.status : current.status,
        usageCount: patch.usageCount !== undefined ? patch.usageCount : current.usageCount,
      }
    : {};

  await prisma.knowledgeItem.update({
    where: { id },
    data: {
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      tags: patch.tags ?? current.tags,
      source: patch.source ?? current.source,
      ...clausePatch,
    },
  });

  // If content changed AND this is a single-chunk (or top-level) item, re-embed.
  if (contentChanged && isEmbeddingsConfigured() && current.chunkTotal === 1) {
    const [vec] = await embed(
      [`${patch.title ?? current.title}\n\n${patch.content}`],
      "document",
      { orgId, operation: "embed_kb" }
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
      toPgVector(vec),
      id
    );
  }
}

/**
 * Delete an item and its chunks (cascade handled by the FK).
 */
/**
 * Remove o item e seus chunks (cascade pela FK).
 *
 * Devolve `false` quando o `where` escopado não casou com nada — o chamador
 * PRECISA disso pra responder 404. `deleteMany` não erra em alvo inexistente,
 * então sem o retorno a rota respondia 200 `{ok:true}` depois de não apagar
 * nada: quem tentasse apagar item fora do próprio escopo era informado de
 * sucesso. Verificado em staging antes de existir este retorno.
 */
export async function deleteKnowledgeItem(
  id: string,
  orgId: string | null,
  opts: KnowledgeScopeGuard & { allowPlatformScope?: boolean } = {}
): Promise<boolean> {
  assertScopeAllowed(orgId, opts.allowPlatformScope, "delete");
  const { count } = await prisma.knowledgeItem.deleteMany({
    where: { id, orgId, ...scopeCategoryWhere(opts) },
  });
  return count > 0;
}
