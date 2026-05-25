-- Datas-marco manuais do funil (Feature: fixar datas na movimentação dos cards).
-- Override usado quando a etapa NÃO foi feita no sistema (sem Envelope fechado /
-- sem CommissionCharge). Nullable, sem default; idempotente.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "contractSignedAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "chargeIssuedAt" TIMESTAMP(3);
