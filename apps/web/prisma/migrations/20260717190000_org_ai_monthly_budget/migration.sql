-- Budget mensal de IA por org (USD). Null = sem teto. Mora em Organization
-- (org-level), não em OrgFinancialSettings (que é per-conta Asaas).
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "aiMonthlyBudgetUsd" DECIMAL(10,2);
