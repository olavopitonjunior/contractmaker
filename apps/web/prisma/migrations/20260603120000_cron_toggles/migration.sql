-- CronToggle (Fase staging B) — controle runtime de quais crons rodam em staging.
-- Em prod a tabela existe mas é ignorada (gate só consulta se STAGING_MODE=true).
-- Aditivo. Idempotente.

CREATE TABLE IF NOT EXISTS "CronToggle" (
  "path" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  CONSTRAINT "CronToggle_pkey" PRIMARY KEY ("path")
);
