-- DefaultWitness.scope — módulo da testemunha padrão ("venda" | "locacao" | "proposta").
-- Idempotente (migrate deploy no build). Rows legadas viram "venda" pelo default.
ALTER TABLE "DefaultWitness" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'venda';

-- Índice novo por (orgId, scope); remove o antigo só-orgId se existir.
DROP INDEX IF EXISTS "DefaultWitness_orgId_idx";
CREATE INDEX IF NOT EXISTS "DefaultWitness_orgId_scope_idx" ON "DefaultWitness" ("orgId", "scope");
