-- Enable pgvector (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable KnowledgeItem
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "chunkTotal" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "tags" TEXT[],
    "source" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- Add the vector column (not visible to Prisma; managed via raw queries)
ALTER TABLE "KnowledgeItem" ADD COLUMN "embedding" vector(1024);

-- Indexes
CREATE INDEX "KnowledgeItem_orgId_category_idx" ON "KnowledgeItem"("orgId", "category");
CREATE INDEX "KnowledgeItem_orgId_parentId_idx" ON "KnowledgeItem"("orgId", "parentId");

-- HNSW index for fast cosine similarity search
CREATE INDEX "KnowledgeItem_embedding_idx" ON "KnowledgeItem" USING hnsw (embedding vector_cosine_ops);

-- Foreign keys
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
