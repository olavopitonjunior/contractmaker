-- Pagadoria v2 — rascunho do wizard de cobrança (2026-05-09)
-- Permite salvar progresso do ChargeWizard e retomar depois.
-- 1 draft por (deal, user). Cleanup diário.

CREATE TABLE IF NOT EXISTS "CommissionChargeDraft" (
  "id"        TEXT PRIMARY KEY,
  "orgId"     TEXT NOT NULL,
  "dealId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "state"     JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "CommissionChargeDraft"
    ADD CONSTRAINT "CommissionChargeDraft_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommissionChargeDraft"
    ADD CONSTRAINT "CommissionChargeDraft_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommissionChargeDraft"
    ADD CONSTRAINT "CommissionChargeDraft_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionChargeDraft_dealId_userId_key"
  ON "CommissionChargeDraft"("dealId", "userId");

CREATE INDEX IF NOT EXISTS "CommissionChargeDraft_orgId_expiresAt_idx"
  ON "CommissionChargeDraft"("orgId", "expiresAt");
