-- Drop dos UNIQUE INDEXes que sobreviveram às migrations anteriores.
--
-- Bug: em 20260510130000_multi_asaas_account e 20260511180000_repair_multi_asaas
-- usamos `ALTER TABLE ... DROP CONSTRAINT IF EXISTS "X_key"` pra remover o
-- @unique legado de AsaasAccount.orgId e OrgFinancialSettings.orgId. Mas
-- esses uniques foram criados originalmente em 20260419011654 via
-- `CREATE UNIQUE INDEX "X_key" ...` — em Postgres isso cria um INDEX, não
-- uma CONSTRAINT associada. `DROP CONSTRAINT` é no-op pra index standalone.
-- Sintoma: 2ª subconta na mesma org ainda explode P2002 mesmo após o "fix".
--
-- Esta migration usa `DROP INDEX IF EXISTS`, que sim remove indexes standalone.
-- Idempotente — se o index já foi removido em outro caminho, vira no-op.
--
-- Também adiciona o @@index([orgId]) substituto (caso ainda não exista).

DROP INDEX IF EXISTS "AsaasAccount_orgId_key";
DROP INDEX IF EXISTS "OrgFinancialSettings_orgId_key";

CREATE INDEX IF NOT EXISTS "AsaasAccount_orgId_idx" ON "AsaasAccount"("orgId");
CREATE INDEX IF NOT EXISTS "OrgFinancialSettings_orgId_idx" ON "OrgFinancialSettings"("orgId");
