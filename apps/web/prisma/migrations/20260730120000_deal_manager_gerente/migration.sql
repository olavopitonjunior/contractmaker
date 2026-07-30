-- Gerente (2026-07): Deal.managerUserId (responsável reatribuível, escopo do
-- role `gerente`) + OrgManagerSettings (toggle de obrigatoriedade + overrides
-- de permissões por org). Idempotente — re-rodável sem erro nem duplicata.

-- Deal.managerUserId
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "managerUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Deal_managerUserId_idx" ON "Deal"("managerUserId");

DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_managerUserId_fkey"
    FOREIGN KEY ("managerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- OrgManagerSettings
CREATE TABLE IF NOT EXISTS "OrgManagerSettings" (
  "id"              TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "managerRequired" BOOLEAN NOT NULL DEFAULT false,
  "permissionsJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrgManagerSettings_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX "OrgManagerSettings_orgId_key" ON "OrgManagerSettings"("orgId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrgManagerSettings" ADD CONSTRAINT "OrgManagerSettings_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
