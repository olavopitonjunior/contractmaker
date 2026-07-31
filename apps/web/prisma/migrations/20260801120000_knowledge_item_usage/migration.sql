-- Contador de uso de KnowledgeItem POR TENANT.
--
-- `KnowledgeItem.usageCount` é global. Enquanto todo item tinha dono isso era
-- inócuo; com a base de plataforma deixou de ser: o `expert-context` ordena as
-- top-8 cláusulas por popularidade e injeta o resultado no prompt de todo turn
-- em modo Planejar. Um tenant que insere a mesma cláusula universal muitas
-- vezes desloca o preâmbulo do agente de OUTRO tenant.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS "KnowledgeItemUsage" (
  "id"              TEXT NOT NULL,
  "knowledgeItemId" TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "count"           INTEGER NOT NULL DEFAULT 0,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeItemUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeItemUsage_knowledgeItemId_orgId_key"
  ON "KnowledgeItemUsage"("knowledgeItemId", "orgId");

-- Ordenação do expert-context: as top-N de uma org.
CREATE INDEX IF NOT EXISTS "KnowledgeItemUsage_orgId_count_idx"
  ON "KnowledgeItemUsage"("orgId", "count");

DO $$ BEGIN
  ALTER TABLE "KnowledgeItemUsage"
    ADD CONSTRAINT "KnowledgeItemUsage_knowledgeItemId_fkey"
    FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "KnowledgeItemUsage"
    ADD CONSTRAINT "KnowledgeItemUsage_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: o histórico de uma linha COM DONO vira o contador daquele dono.
--
-- Linha de PLATAFORMA (`orgId IS NULL`) fica de fora de propósito: o uso
-- acumulado não pertence a org nenhuma e não há como reparti-lo. Herdar o total
-- para todas as orgs seria inventar dado. O efeito prático é que, nas primeiras
-- semanas, cláusula universal não aparece no top-8 por popularidade — aceitável
-- perto de fabricar um número.
INSERT INTO "KnowledgeItemUsage" ("id", "knowledgeItemId", "orgId", "count", "updatedAt")
SELECT
  'kiu_' || substr(md5(k."id" || k."orgId"), 1, 21),
  k."id",
  k."orgId",
  k."usageCount",
  NOW()
FROM "KnowledgeItem" k
WHERE k."orgId" IS NOT NULL
  AND k."usageCount" > 0
ON CONFLICT ("knowledgeItemId", "orgId") DO NOTHING;
