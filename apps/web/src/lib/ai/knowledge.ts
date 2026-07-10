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
  orgId: string;
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
}

export interface KnowledgeItemRow {
  id: string;
  orgId: string;
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
 * Cria as linhas do knowledge item **sem** gerar embeddings — retorna os alvos
 * de embedding pro caller decidir quando embutir (síncrono via
 * `createKnowledgeItem`, ou em background via `waitUntil(embedKnowledgeItem(...))`
 * num endpoint de upload, onde a chamada ao Voyage não pode segurar a resposta).
 *
 * Mantém a semântica original: single-chunk embute a própria linha; multi-chunk
 * cria um parent-resumo (não embutido) + linhas-filhas embutidas.
 */
export async function createKnowledgeItemRows(
  input: CreateKnowledgeItemInput
): Promise<{ parentId: string; embedTargets: EmbedTarget[] }> {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    throw new Error("Conteúdo vazio após limpeza");
  }

  const extras = clauseExtras(input);

  // Short path: single chunk = single row (no parent/children split)
  if (chunks.length === 1) {
    const parent = await prisma.knowledgeItem.create({
      data: {
        orgId: input.orgId,
        category: input.category,
        title: input.title,
        content: chunks[0].text,
        chunkIndex: 0,
        chunkTotal: 1,
        parentId: null,
        tags: input.tags ?? [],
        source: input.source ?? "manual",
        createdBy: input.createdBy ?? null,
        ...extras,
      },
    });
    return {
      parentId: parent.id,
      embedTargets: [{ id: parent.id, text: `${input.title}\n\n${chunks[0].text}` }],
    };
  }

  // Multi-chunk path: create parent row, then chunk rows linked to parent
  const parent = await prisma.knowledgeItem.create({
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
      ...extras,
    },
  });

  const chunkRows = await Promise.all(
    chunks.map((chunk) =>
      prisma.knowledgeItem.create({
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
  ctx: { orgId: string; userId?: string | null }
): Promise<void> {
  if (!isEmbeddingsConfigured() || targets.length === 0) return;
  const vectors = await embed(
    targets.map((t) => t.text),
    "document",
    { orgId: ctx.orgId, userId: ctx.userId, operation: "embed_kb" }
  );
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
  orgId: string,
  patch: Partial<Omit<CreateKnowledgeItemInput, "orgId" | "category">>
): Promise<void> {
  const current = await prisma.knowledgeItem.findFirst({
    where: { id, orgId },
  });
  if (!current) throw new Error("Item não encontrado");

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
export async function deleteKnowledgeItem(id: string, orgId: string): Promise<void> {
  await prisma.knowledgeItem.deleteMany({ where: { id, orgId } });
}
