-- AsaasAccount.kycToken — token público da rota /kyc/[token] hospedada
-- pelo Contractmaker. UI alternativa ao painel Asaas para o titular enviar
-- documentos sem depender do email de ativação.
ALTER TABLE "AsaasAccount" ADD COLUMN "kycToken" TEXT;
CREATE UNIQUE INDEX "AsaasAccount_kycToken_key" ON "AsaasAccount"("kycToken");

-- Backfill: para contas existentes não aprovadas, gera um token aleatório
-- usando concatenação de gen_random_uuid() (provém entropia suficiente).
UPDATE "AsaasAccount"
SET "kycToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "kycToken" IS NULL
  AND "status" <> 'APPROVED';
