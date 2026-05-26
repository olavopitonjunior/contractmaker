-- Multitenant Fase 1d — hierarquia de subcontas Asaas (conta-mãe da plataforma).
-- parentAccountId = id da AsaasAccount-mãe quando esta é subconta-filha. Idempotente.
ALTER TABLE "AsaasAccount" ADD COLUMN IF NOT EXISTS "parentAccountId" TEXT;
