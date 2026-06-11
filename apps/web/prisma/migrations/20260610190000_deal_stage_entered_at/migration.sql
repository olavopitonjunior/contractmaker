-- Aging por stage: Deal.stageEnteredAt = quando o deal entrou no stage atual.
-- 3 passos deliberados: ADD sem default (senão o Postgres preencheria as
-- linhas existentes com now() e o aging de todo deal antigo seria zerado),
-- backfill aproximado com updatedAt (melhor sinal disponível), e só então o
-- DEFAULT pra inserts novos. Idempotente.

ALTER TABLE "Deal"
  ADD COLUMN IF NOT EXISTS "stageEnteredAt" TIMESTAMP(3);

UPDATE "Deal"
   SET "stageEnteredAt" = COALESCE("updatedAt", "createdAt")
 WHERE "stageEnteredAt" IS NULL;

ALTER TABLE "Deal"
  ALTER COLUMN "stageEnteredAt" SET DEFAULT CURRENT_TIMESTAMP;
