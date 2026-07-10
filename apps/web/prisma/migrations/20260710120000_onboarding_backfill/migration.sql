-- Onboarding self-service (checklist "Primeiros passos" na sidebar): as orgs que
-- já existem no momento do deploy estão operando e NÃO devem ver o guia. Marca
-- todas como concluídas; só tenants criados DEPOIS (onboardingCompletedAt null)
-- exibem o checklist até 100%. Idempotente (só toca linhas ainda nulas).
UPDATE "Organization" SET "onboardingCompletedAt" = now() WHERE "onboardingCompletedAt" IS NULL;
