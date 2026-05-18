-- Unifica Clause → KnowledgeItem (category="clause"). Migration big-bang
-- idempotente: pode rodar em DB já migrada sem efeito. Janela de rollback
-- 30d: tabela Clause vai pra "Clause_legacy" (mantida intacta).
--
-- Ordem de operações:
--  1. ALTER KnowledgeItem  : adicionar 7 colunas + 2 indexes (IF NOT EXISTS)
--  2. INSERT em KnowledgeItem a partir de Clause (idempotente via legacyClauseId)
--  3. ALTER ContractClause : adicionar coluna knowledgeItemId
--  4. UPDATE ContractClause: popular knowledgeItemId via legacyClauseId
--  5. DROP FK clauseId + UNIQUE; ALTER NOT NULL knowledgeItemId; ADD FK + UNIQUE
--  6. DROP COLUMN clauseId em ContractClause
--  7. ALTER TABLE Clause RENAME TO Clause_legacy

-- 1) Novas colunas em KnowledgeItem ---------------------------------------------
ALTER TABLE "KnowledgeItem"
  ADD COLUMN IF NOT EXISTS "agentNotes"     TEXT,
  ADD COLUMN IF NOT EXISTS "groupCode"      TEXT,
  ADD COLUMN IF NOT EXISTS "subcategory"    TEXT,
  ADD COLUMN IF NOT EXISTS "isVariable"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status"         TEXT    NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "usageCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "legacyClauseId" TEXT;

CREATE INDEX IF NOT EXISTS "KnowledgeItem_orgId_category_groupCode_idx"
  ON "KnowledgeItem"("orgId", "category", "groupCode");

CREATE INDEX IF NOT EXISTS "KnowledgeItem_legacyClauseId_idx"
  ON "KnowledgeItem"("legacyClauseId");

-- 2) Copia Clause → KnowledgeItem (idempotente) ---------------------------------
-- Skip se a tabela Clause não existir (DB já passou pelo rename ou seed clean).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Clause') THEN
    INSERT INTO "KnowledgeItem" (
      id, "orgId", category, title, content,
      "chunkIndex", "chunkTotal", "parentId",
      tags, source, "createdBy",
      "agentNotes", "groupCode", subcategory, "isVariable", status, "usageCount",
      "legacyClauseId", "createdAt", "updatedAt"
    )
    SELECT
      -- ID novo: 'c' + UUID hex sem traços. cuid-shape não é exigido pelo
      -- Prisma (campo é só String) e gen_random_uuid() é nativo do Postgres
      -- 13+, sem precisar da extensão pgcrypto (que Neon free tier exige
      -- ativar manualmente).
      CONCAT('c', REPLACE(gen_random_uuid()::text, '-', '')),
      c."orgId",
      'clause',
      c.title,
      c.content,
      0, 1, NULL,
      c.tags,
      COALESCE(c.source, 'manual'),
      c."authorId",
      c."agentNotes",
      c."groupCode",
      c.subcategory,
      c."isVariable",
      c.status,
      c."usageCount",
      c.id,
      c."createdAt",
      c."updatedAt"
    FROM "Clause" c
    WHERE NOT EXISTS (
      SELECT 1 FROM "KnowledgeItem" k WHERE k."legacyClauseId" = c.id
    );
  END IF;
END $$;

-- 3) Adiciona knowledgeItemId em ContractClause --------------------------------
ALTER TABLE "ContractClause"
  ADD COLUMN IF NOT EXISTS "knowledgeItemId" TEXT;

-- 4) Popula knowledgeItemId baseado em legacyClauseId mapping ------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ContractClause' AND column_name = 'clauseId'
  ) THEN
    UPDATE "ContractClause" cc
    SET "knowledgeItemId" = ki.id
    FROM "KnowledgeItem" ki
    WHERE ki."legacyClauseId" = cc."clauseId"
      AND cc."knowledgeItemId" IS NULL;
  END IF;
END $$;

-- 5) FK + UNIQUE: troca clauseId → knowledgeItemId -----------------------------
ALTER TABLE "ContractClause"
  DROP CONSTRAINT IF EXISTS "ContractClause_clauseId_fkey",
  DROP CONSTRAINT IF EXISTS "ContractClause_contractId_clauseId_key";

-- Só vira NOT NULL + cria FK quando todas as rows já estão populadas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ContractClause" WHERE "knowledgeItemId" IS NULL
  ) THEN
    ALTER TABLE "ContractClause"
      ALTER COLUMN "knowledgeItemId" SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ContractClause_knowledgeItemId_fkey'
    ) THEN
      ALTER TABLE "ContractClause"
        ADD CONSTRAINT "ContractClause_knowledgeItemId_fkey"
          FOREIGN KEY ("knowledgeItemId")
          REFERENCES "KnowledgeItem"(id)
          ON DELETE RESTRICT
          ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ContractClause_contractId_knowledgeItemId_key'
    ) THEN
      ALTER TABLE "ContractClause"
        ADD CONSTRAINT "ContractClause_contractId_knowledgeItemId_key"
          UNIQUE ("contractId", "knowledgeItemId");
    END IF;
  END IF;
END $$;

-- 6) Remove a coluna clauseId (se ainda existir) --------------------------------
ALTER TABLE "ContractClause" DROP COLUMN IF EXISTS "clauseId";

-- 7) Rename Clause → Clause_legacy (janela de rollback 30d) --------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Clause') THEN
    ALTER TABLE "Clause" RENAME TO "Clause_legacy";
  END IF;
END $$;
