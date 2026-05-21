-- Categoria determinística de templates (forma de pagamento → template).
-- Adiciona ContractTemplate.category + index, e faz backfill a partir de
-- `modalidade` (os 2 templates atuais viram os principais dos 2 grupos):
--   modalidade='a_vista'       -> category='compra_e_venda'
--   modalidade='financiamento' -> category='financiamento'

ALTER TABLE "ContractTemplate" ADD COLUMN "category" TEXT;

UPDATE "ContractTemplate"
SET "category" = CASE
  WHEN "modalidade" = 'financiamento' THEN 'financiamento'
  ELSE 'compra_e_venda'
END
WHERE "category" IS NULL;

CREATE INDEX "ContractTemplate_orgId_category_status_idx"
  ON "ContractTemplate" ("orgId", "category", "status");
