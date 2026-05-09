-- Charge categorization + notification preferences (Pagadoria 2026-05-09)
-- Idempotente: ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

-- 1. CommissionCharge.categoryLabel — texto livre pra avulsas
ALTER TABLE "CommissionCharge"
  ADD COLUMN IF NOT EXISTS "categoryLabel" TEXT;

-- 2. OrgFinancialSettings — preferências de régua interna (corretor/admin/comissionado)
ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyOwnerOnCreated" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyOwnerOnPaid" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyOwnerOnOverdue" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyOwnerOnDueSoon" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyAdminsOnPaid" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "notifyComissionados" BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. SplitRecipient.email — para notificar comissionado quando split é pago
ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "email" TEXT;
