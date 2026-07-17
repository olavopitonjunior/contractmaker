-- Budget mensal de IA por org (USD). Null = sem teto.
ALTER TABLE "OrgFinancialSettings"
  ADD COLUMN IF NOT EXISTS "aiMonthlyBudgetUsd" DECIMAL(10,2);
