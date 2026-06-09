-- Dados cadastrais da imobiliária (administradora nomeada nos contratos de
-- locação). Aditivo e idempotente.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cnpj" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "creci" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "legalAddress" TEXT;
