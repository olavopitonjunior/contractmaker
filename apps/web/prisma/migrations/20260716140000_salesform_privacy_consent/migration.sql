-- Consentimento LGPD persistido no SalesForm (antes era só estado de UI).
-- Idempotente.
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "privacyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "privacyIpHash" TEXT;
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "privacyPolicyVersion" TEXT;
