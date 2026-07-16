-- DB hygiene: DEFAULT '{}' nos String[] que faltavam (previne 23502 em insert
-- fora do Prisma / migração que adicione coluna) + índice (orgId, kind) em
-- CommissionCharge pros dashboards que filtram por tipo. Tudo idempotente.

-- `Clause` foi unificada em `KnowledgeItem` (20260518 unify_clause) em alguns
-- ambientes; guardar a existência mantém a migration idempotente (senão 42P01
-- "relation Clause does not exist" trava o migrate deploy inteiro).
DO $$ BEGIN
  IF to_regclass('"Clause"') IS NOT NULL THEN
    ALTER TABLE "Clause" ALTER COLUMN "tags" SET DEFAULT '{}';
  END IF;
  IF to_regclass('"ClauseProposal"') IS NOT NULL THEN
    ALTER TABLE "ClauseProposal" ALTER COLUMN "tags" SET DEFAULT '{}';
  END IF;
END $$;
ALTER TABLE "KnowledgeItem"   ALTER COLUMN "tags"           SET DEFAULT '{}';
ALTER TABLE "EnvelopeSigner"  ALTER COLUMN "requirementIds" SET DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "CommissionCharge_orgId_kind_idx"
  ON "CommissionCharge" ("orgId", "kind");
