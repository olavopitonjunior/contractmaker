-- Rastreio de envio do email de ativação do Asaas.
-- activationLinkSentAt: setado quando a subconta é criada (Asaas envia auto).
-- activationLinkResentAt: setado quando o admin clica em "Reenviar"
-- (Asaas só aceita 1× via API).
ALTER TABLE "AsaasAccount" ADD COLUMN "activationLinkSentAt" TIMESTAMP(3);
ALTER TABLE "AsaasAccount" ADD COLUMN "activationLinkResentAt" TIMESTAMP(3);

-- Backfill: como toda subconta criada pelo POST /accounts recebe email
-- automaticamente, marcamos createdAt como sentAt — exceto contas órfãs
-- (status PENDING + apiKey via accessTokens recovery, raras).
UPDATE "AsaasAccount"
SET "activationLinkSentAt" = "createdAt"
WHERE "activationLinkSentAt" IS NULL;
