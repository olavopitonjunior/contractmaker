-- PR-2: rastrear a última taxa real de PIX externo observada na conta
-- Asaas, em centavos. Atualizada automaticamente quando transferFee chega
-- na resposta de POST /v3/transfers (split_dispatch). Usada pelo
-- splitDispatcher quando pixSplitFeePolicy = "deduct_from_recipient".

ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN "lastObservedPixFeeCents" INTEGER NOT NULL DEFAULT 100;
