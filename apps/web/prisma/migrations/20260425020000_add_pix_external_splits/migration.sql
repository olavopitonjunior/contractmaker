-- Fase 6: split de pagamento via PIX externo direto para conta do beneficiário.
-- Estende SplitRecipient para suportar dois tipos:
--   asaas_wallet  — wallet Asaas (split nativo da plataforma, gratuito, instantâneo)
--   pix_external  — PIX em outro banco (transferência Asaas pós-pagamento)
-- Estende AsaasTransfer para rastrear transferências automáticas geradas a partir
-- de cobranças pagas + idempotência via UNIQUE(commissionChargeId, splitRecipientId).
-- Adiciona política de absorção de taxa em OrgFinancialSettings.

-- 1. SplitRecipient: novos campos + walletId nullable
ALTER TABLE "SplitRecipient"
  ALTER COLUMN "walletId" DROP NOT NULL,
  ADD COLUMN "recipientType" TEXT NOT NULL DEFAULT 'asaas_wallet',
  ADD COLUMN "pixAddressKey" TEXT,
  ADD COLUMN "pixKeyType" TEXT,
  ADD COLUMN "ownerName" TEXT,
  ADD COLUMN "ownerCpfCnpj" TEXT;

-- Constraint composto walletId já existe; adicionar para pixAddressKey
CREATE UNIQUE INDEX "SplitRecipient_orgId_pixAddressKey_key"
  ON "SplitRecipient"("orgId", "pixAddressKey");

CREATE INDEX "SplitRecipient_orgId_recipientType_idx"
  ON "SplitRecipient"("orgId", "recipientType");

-- 2. OrgFinancialSettings: política de taxa PIX
ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN "pixSplitFeePolicy" TEXT NOT NULL DEFAULT 'org_absorbs';

-- 3. AsaasTransfer: rastreabilidade + idempotência para split-dispatch
--    asaasTransferId fica nullable (criamos o registro local ANTES de chamar a API)
ALTER TABLE "AsaasTransfer"
  ALTER COLUMN "asaasTransferId" DROP NOT NULL,
  ALTER COLUMN "requestedBy" DROP NOT NULL,
  ADD COLUMN "commissionChargeId" TEXT,
  ADD COLUMN "splitRecipientId" TEXT,
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE "AsaasTransfer"
  ADD CONSTRAINT "AsaasTransfer_commissionChargeId_fkey"
  FOREIGN KEY ("commissionChargeId") REFERENCES "CommissionCharge"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AsaasTransfer"
  ADD CONSTRAINT "AsaasTransfer_splitRecipientId_fkey"
  FOREIGN KEY ("splitRecipientId") REFERENCES "SplitRecipient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AsaasTransfer_commissionChargeId_idx"
  ON "AsaasTransfer"("commissionChargeId");

-- Idempotência: um único transfer por (charge × recipient).
-- Permite múltiplas tentativas DEPOIS de delete (improvável) mas previne
-- duplicatas no fire-and-forget do webhook.
CREATE UNIQUE INDEX "AsaasTransfer_commissionChargeId_splitRecipientId_key"
  ON "AsaasTransfer"("commissionChargeId", "splitRecipientId")
  WHERE "commissionChargeId" IS NOT NULL AND "splitRecipientId" IS NOT NULL;
