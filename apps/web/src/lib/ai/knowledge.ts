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
  | "clause";

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

/**
 * Create a knowledge item. If content is long enough, split into chunks; each
 * chunk becomes its own row with a shared parentId. Embeddings are generated
 * in a single batch call to minimize API cost.
 */
export async function createKnowledgeItem(
  input: CreateKnowledgeItemInput
): Promise<{ parentId: string; chunksCreated: number }> {
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

    if (isEmbeddingsConfigured()) {
      const [vec] = await embed(
        [`${input.title}\n\n${chunks[0].text}`],
        "document",
        { orgId: input.orgId, userId: input.createdBy, operation: "embed_kb" }
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
        toPgVector(vec),
        parent.id
      );
    }

    return { parentId: parent.id, chunksCreated: 1 };
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

  if (isEmbeddingsConfigured()) {
    const texts = chunks.map((c) => `${input.title}\n\n${c.text}`);
    const vectors = await embed(texts, "document", {
      orgId: input.orgId,
      userId: input.createdBy,
      operation: "embed_kb",
    });
    for (let i = 0; i < chunkRows.length; i++) {
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
        toPgVector(vectors[i]),
        chunkRows[i].id
      );
    }
  }

  return { parentId: parent.id, chunksCreated: chunks.length };
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
