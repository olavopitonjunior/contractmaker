-- Reaplica a estrutura pgvector de forma idempotente. A migration original
-- 20260413150000_add_knowledge_base falha silenciosamente em ambientes onde
-- a extensão "vector" não estava instalada na hora do deploy — Postgres rola
-- back o ADD COLUMN dentro da transação, mas o migration record fica como
-- aplicado. Resultado em prod: chamadas pgvector quebram com code 42703
-- "column embedding does not exist", e o agente perde a tool query_knowledge_base.
--
-- Esta migration garante extension + colunas + índices HNSW idempotentes.
-- Re-aplicar é no-op em ambientes saudáveis.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "KnowledgeItem"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

ALTER TABLE "ContractMemory"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

CREATE INDEX IF NOT EXISTS "KnowledgeItem_embedding_idx"
  ON "KnowledgeItem" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "ContractMemory_embedding_idx"
  ON "ContractMemory" USING hnsw (embedding vector_cosine_ops);
