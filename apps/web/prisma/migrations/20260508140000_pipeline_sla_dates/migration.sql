-- Pipeline SLA — datas-marco do funil pós-assinatura.
-- Aditivo: todos os campos novos são nullable, deals/forms existentes
-- continuam válidos. Backfill de SalesForm.completedAt é best-effort
-- (formulários já completos ganham completedAt = updatedAt).

ALTER TABLE "SalesForm" ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "Deal" ADD COLUMN "commissionPaidAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "lostAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "lostReason" TEXT;

-- Backfill histórico — formulários já finalizados ganham completedAt
-- aproximado por updatedAt (last write antes da introdução do campo).
UPDATE "SalesForm"
   SET "completedAt" = "updatedAt"
 WHERE "status" IN ('completo', 'vinculado')
   AND "completedAt" IS NULL;
