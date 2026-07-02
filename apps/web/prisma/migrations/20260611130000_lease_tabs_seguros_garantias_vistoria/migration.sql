-- Abas Seguros/Garantias/Vistoria na tela do contrato de locação.
-- Idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) — re-rodável.

-- InsurancePolicy: campos do wizard de contratação manual (API-ready)
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "origem" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "expenseId" TEXT;
ALTER TABLE "InsurancePolicy" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Guarantee: payload por modalidade + documento + histórico de substituições
ALTER TABLE "Guarantee" ADD COLUMN IF NOT EXISTS "dadosJson" JSONB;
ALTER TABLE "Guarantee" ADD COLUMN IF NOT EXISTS "documentoPdfUrl" TEXT;
ALTER TABLE "Guarantee" ADD COLUMN IF NOT EXISTS "historicoJson" JSONB;

-- Inspection: lookup por envelopeId no fechamento ClickSign (webhook/sync/cron)
CREATE INDEX IF NOT EXISTS "Inspection_envelopeId_idx" ON "Inspection"("envelopeId");
