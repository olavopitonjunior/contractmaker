-- AIUsage.contractId deixa de ser FK pra Contract.
-- Motivo: a FK tinha ON DELETE SET NULL, então apagar um Contract ZERAVA
-- retroativamente a atribuição de custo/tokens de todas as linhas de AIUsage
-- daquele contrato — o custo já gasto virava órfão sem rastro do contrato.
-- Virando coluna simples, o id sobrevive à deleção (dangling, mas rastreável).
-- Idempotente: só dropa a constraint se ela existir. O índice em contractId
-- (@@index([contractId, createdAt])) é preservado — continua útil pra agregação.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AIUsage_contractId_fkey'
  ) THEN
    ALTER TABLE "AIUsage" DROP CONSTRAINT "AIUsage_contractId_fkey";
  END IF;
END $$;
