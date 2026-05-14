-- ChatSession multi-session support: title, archived, updatedAt + index.
-- Idempotente — re-aplicar em ambiente que ja tem os campos vira no-op.

ALTER TABLE "ChatSession"
  ADD COLUMN IF NOT EXISTS "title" TEXT;

ALTER TABLE "ChatSession"
  ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ChatSession"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Index pra sidebar "Sessions recentes deste contrato" (filter archived=false
-- + order by updatedAt desc).
CREATE INDEX IF NOT EXISTS "ChatSession_contractId_archived_updatedAt_idx"
  ON "ChatSession"("contractId", "archived", "updatedAt" DESC);
