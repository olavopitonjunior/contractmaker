-- DIMOB: selo de validação do leiaute (versão confirmada no PGD). Idempotente.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "dimobLayoutValidatedVersion" TEXT;
