-- Onboarding: marcador "dono já viu o modal de boas-vindas" (1º acesso). Aditivo,
-- idempotente. Enquanto null + onboarding incompleto, a home "/" leva o owner
-- pro /onboarding uma vez.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "onboardingIntroSeenAt" TIMESTAMP(3);
