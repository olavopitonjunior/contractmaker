-- Multi-account Asaas: troca single-account-per-org por N contas + seletor admin
-- + capabilities por (account, user). Idempotente: tudo `IF NOT EXISTS` / `IF EXISTS`.
--
-- Backfill assume snapshot pré-migration: 1 AsaasAccount por org. A migration
-- promove essa conta para "ativa" e replica orgId → accountId em registros
-- dependentes. Pós-migration o admin pode criar contas adicionais via UI.

-- 1) AsaasAccount: troca @unique(orgId) por @index, adiciona label/archivedAt
ALTER TABLE "AsaasAccount" DROP CONSTRAINT IF EXISTS "AsaasAccount_orgId_key";
CREATE INDEX IF NOT EXISTS "AsaasAccount_orgId_idx" ON "AsaasAccount"("orgId");
ALTER TABLE "AsaasAccount" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "AsaasAccount" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- 2) Organization.activeAsaasAccountId — conta selecionada pelo admin
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "activeAsaasAccountId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Organization_activeAsaasAccountId_fkey'
  ) THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_activeAsaasAccountId_fkey"
      FOREIGN KEY ("activeAsaasAccountId") REFERENCES "AsaasAccount"("id") ON DELETE SET NULL;
  END IF;
END$$;

-- Backfill: org com 1 conta vira essa conta como ativa
UPDATE "Organization" o
   SET "activeAsaasAccountId" = a.id
  FROM "AsaasAccount" a
 WHERE a."orgId" = o.id
   AND o."activeAsaasAccountId" IS NULL;

-- 3) accountId em tabelas de escopo per-account
ALTER TABLE "CommissionCharge"   ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "AsaasCustomer"      ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "AsaasTransfer"      ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "BankReconciliation" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "AsaasWebhookEvent"  ADD COLUMN IF NOT EXISTS "accountId" TEXT;

UPDATE "CommissionCharge"   c SET "accountId" = a.id FROM "AsaasAccount" a WHERE a."orgId" = c."orgId" AND c."accountId" IS NULL;
UPDATE "AsaasCustomer"      x SET "accountId" = a.id FROM "AsaasAccount" a WHERE a."orgId" = x."orgId" AND x."accountId" IS NULL;
UPDATE "AsaasTransfer"      t SET "accountId" = a.id FROM "AsaasAccount" a WHERE a."orgId" = t."orgId" AND t."accountId" IS NULL;
UPDATE "BankReconciliation" b SET "accountId" = a.id FROM "AsaasAccount" a WHERE a."orgId" = b."orgId" AND b."accountId" IS NULL;
UPDATE "AsaasWebhookEvent"  e SET "accountId" = a.id FROM "AsaasAccount" a WHERE a."orgId" = e."orgId" AND e."accountId" IS NULL;

-- FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionCharge_accountId_fkey') THEN
    ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasCustomer_accountId_fkey') THEN
    ALTER TABLE "AsaasCustomer" ADD CONSTRAINT "AsaasCustomer_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasTransfer_accountId_fkey') THEN
    ALTER TABLE "AsaasTransfer" ADD CONSTRAINT "AsaasTransfer_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BankReconciliation_accountId_fkey') THEN
    ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasWebhookEvent_accountId_fkey') THEN
    ALTER TABLE "AsaasWebhookEvent" ADD CONSTRAINT "AsaasWebhookEvent_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE SET NULL;
  END IF;
END$$;

-- 4) AsaasCustomer dedupe vira por (accountId, *) — cliente Asaas é per-subconta
ALTER TABLE "AsaasCustomer" DROP CONSTRAINT IF EXISTS "AsaasCustomer_orgId_cpfCnpj_key";
ALTER TABLE "AsaasCustomer" DROP CONSTRAINT IF EXISTS "AsaasCustomer_orgId_asaasId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCustomer_accountId_cpfCnpj_key" ON "AsaasCustomer"("accountId", "cpfCnpj");
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCustomer_accountId_asaasId_key" ON "AsaasCustomer"("accountId", "asaasId");

CREATE INDEX IF NOT EXISTS "CommissionCharge_accountId_idx" ON "CommissionCharge"("accountId");
CREATE INDEX IF NOT EXISTS "AsaasTransfer_accountId_idx"    ON "AsaasTransfer"("accountId");

-- 5) OrgFinancialSettings vira per-account
ALTER TABLE "OrgFinancialSettings" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
UPDATE "OrgFinancialSettings" s
   SET "accountId" = a.id
  FROM "AsaasAccount" a
 WHERE a."orgId" = s."orgId"
   AND s."accountId" IS NULL;

-- Settings sem accountId após backfill = órfãos sem AsaasAccount; manter
-- column nullable se houver órfãos, senão NOT NULL.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM "OrgFinancialSettings" WHERE "accountId" IS NULL;
  IF orphan_count = 0 THEN
    EXECUTE 'ALTER TABLE "OrgFinancialSettings" ALTER COLUMN "accountId" SET NOT NULL';
  END IF;
END$$;

ALTER TABLE "OrgFinancialSettings" DROP CONSTRAINT IF EXISTS "OrgFinancialSettings_orgId_key";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrgFinancialSettings_accountId_key') THEN
    ALTER TABLE "OrgFinancialSettings" ADD CONSTRAINT "OrgFinancialSettings_accountId_key" UNIQUE ("accountId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrgFinancialSettings_accountId_fkey') THEN
    ALTER TABLE "OrgFinancialSettings" ADD CONSTRAINT "OrgFinancialSettings_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE CASCADE;
  END IF;
END$$;

-- 6) AsaasAccountPermission — capabilities granulares por (account, user)
CREATE TABLE IF NOT EXISTS "AsaasAccountPermission" (
  "id"         TEXT PRIMARY KEY,
  "accountId"  TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "grantedBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasAccountPermission_accountId_fkey') THEN
    ALTER TABLE "AsaasAccountPermission" ADD CONSTRAINT "AsaasAccountPermission_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasAccountPermission_userId_fkey') THEN
    ALTER TABLE "AsaasAccountPermission" ADD CONSTRAINT "AsaasAccountPermission_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "AsaasAccountPermission_unique"
  ON "AsaasAccountPermission"("accountId", "userId", "capability");
CREATE INDEX IF NOT EXISTS "AsaasAccountPermission_userId_idx"
  ON "AsaasAccountPermission"("userId");
