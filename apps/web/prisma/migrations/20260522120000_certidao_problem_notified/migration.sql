-- Fase 2 do fluxo de problemas de certidões: controla quais falhas terminais
-- já entraram no e-mail resumo diário (cron problem-digest). Idempotente.
ALTER TABLE "CertidaoJob" ADD COLUMN IF NOT EXISTS "problemNotifiedAt" TIMESTAMP(3);
