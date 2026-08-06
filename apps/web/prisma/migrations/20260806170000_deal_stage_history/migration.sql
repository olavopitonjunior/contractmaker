-- Histórico de permanência por stage + política de SLA + SLA materializado no
-- Deal (plano 2026-08-06, Fase 3 / PR 3.1). Idempotente (deploy roda no build).
-- SEM backfill aqui — a migration set-based de backfill vem no PR 3.2.

CREATE TABLE IF NOT EXISTS "DealStageHistory" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "dealId"        TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "stageId"       TEXT NOT NULL,
  "stageName"     TEXT NOT NULL,
  "stagePosition" INTEGER NOT NULL,
  "fromStageId"   TEXT,
  "enteredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt"      TIMESTAMP(3),
  "durationSec"   INTEGER,
  "slaWarnDays"   INTEGER,
  "slaDangerDays" INTEGER,
  "reason"        TEXT NOT NULL,
  "actorUserId"   TEXT,
  "estimated"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DealStageHistory_dealId_enteredAt_idx"
  ON "DealStageHistory" ("dealId", "enteredAt");
CREATE INDEX IF NOT EXISTS "DealStageHistory_orgId_kind_stageId_exitedAt_idx"
  ON "DealStageHistory" ("orgId", "kind", "stageId", "exitedAt");
CREATE INDEX IF NOT EXISTS "DealStageHistory_orgId_kind_enteredAt_idx"
  ON "DealStageHistory" ("orgId", "kind", "enteredAt");

-- INVARIANTE: no máximo UM intervalo aberto por deal. Índice único PARCIAL —
-- Prisma não modela; NÃO remover num `prisma migrate dev` futuro (assertiva em
-- scripts/check-migrations.ts via pg_indexes).
CREATE UNIQUE INDEX IF NOT EXISTS "DealStageHistory_open_interval_key"
  ON "DealStageHistory" ("dealId")
  WHERE "exitedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DealStageHistory_dealId_fkey'
  ) THEN
    ALTER TABLE "DealStageHistory"
      ADD CONSTRAINT "DealStageHistory_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SlaPolicy" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "scope"      TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "warnDays"   INTEGER NOT NULL,
  "dangerDays" INTEGER NOT NULL,
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SlaPolicy_orgId_scope_key_key"
  ON "SlaPolicy" ("orgId", "scope", "key");
CREATE INDEX IF NOT EXISTS "SlaPolicy_orgId_kind_idx"
  ON "SlaPolicy" ("orgId", "kind");

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "slaWarnAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "slaDueAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Deal_pipelineId_slaDueAt_idx"
  ON "Deal" ("pipelineId", "slaDueAt");
