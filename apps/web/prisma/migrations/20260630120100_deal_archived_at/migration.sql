-- Deal.archivedAt — arquivamento explícito (tira do kanban sem apagar).
-- Paridade com os models de locação que já têm archivedAt. Idempotente.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Deal_pipelineId_archivedAt_idx" ON "Deal"("pipelineId", "archivedAt");
