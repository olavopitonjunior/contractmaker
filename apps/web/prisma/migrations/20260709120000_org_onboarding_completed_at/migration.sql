-- Onboarding self-service: flag pra parar o auto-launch do wizard.
-- O progresso em si é derivado dos dados (lib/onboarding/status.ts); esta coluna
-- só marca que o dono concluiu/pulou o tour ou gerou o 1º contrato.
-- Aditiva e idempotente.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);
