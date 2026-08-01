-- Custo de IA por AGENTE, e custo de plataforma deixando de sumir.
--
-- Idempotente.

-- 1. Agente responsável pela chamada. Nullable: linha histórica não tem, e o
--    backfill abaixo cobre o que dá pra inferir de `operation`.
ALTER TABLE "AIUsage" ADD COLUMN IF NOT EXISTS "agentKey" TEXT;

-- 2. `orgId` passa a aceitar NULL = custo de PLATAFORMA (ingestão e embedding
--    da base universal). Antes era NOT NULL, então essas chamadas simplesmente
--    NÃO ERAM REGISTRADAS — `embedKnowledgeItem` pulava o registro quando não
--    havia org. O painel mostrava zero onde havia gasto real, e com a ingestão
--    em lote na plataforma isso deixaria de ser "um punhado de itens".
ALTER TABLE "AIUsage" ALTER COLUMN "orgId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "AIUsage_orgId_agentKey_createdAt_idx"
  ON "AIUsage"("orgId", "agentKey", "createdAt");

-- 3. Backfill do histórico pelo mapa `operation → agentKey` do registry
--    (lib/ai/agents/registry.ts). Só o que é inequívoco: operação que pertence
--    a exatamente um agente. `chat` fica de fora de propósito — é do agente
--    legado E dos especialistas, e atribuir tudo a um deles seria inventar
--    dado num painel de custo.
UPDATE "AIUsage" SET "agentKey" = 'passive'
 WHERE "agentKey" IS NULL AND operation IN ('passive_open', 'passive_edit');

UPDATE "AIUsage" SET "agentKey" = 'ocr'
 WHERE "agentKey" IS NULL
   AND operation IN ('ocr_form', 'ocr_tool', 'extract_ccv_doc', 'extract_locacao_doc', 'voice_extract');

UPDATE "AIUsage" SET "agentKey" = 'insights'
 WHERE "agentKey" IS NULL AND operation = 'insights';

UPDATE "AIUsage" SET "agentKey" = 'support'
 WHERE "agentKey" IS NULL AND operation IN ('support_chat', 'assistant_chat');

UPDATE "AIUsage" SET "agentKey" = 'analyst'
 WHERE "agentKey" IS NULL AND operation = 'specialist_analyst';
UPDATE "AIUsage" SET "agentKey" = 'legal'
 WHERE "agentKey" IS NULL AND operation = 'specialist_legal';
UPDATE "AIUsage" SET "agentKey" = 'editor'
 WHERE "agentKey" IS NULL AND operation = 'specialist_editor';
UPDATE "AIUsage" SET "agentKey" = 'curator'
 WHERE "agentKey" IS NULL AND operation = 'specialist_curator';
