-- DB hygiene: DEFAULT '{}' nos String[] que faltavam (previne 23502 em insert
-- fora do Prisma / migração que adicione coluna) + índice (orgId, kind) em
-- CommissionCharge pros dashboards que filtram por tipo. Tudo idempotente.

ALTER TABLE "Clause"          ALTER COLUMN "tags"           SET DEFAULT '{}';
ALTER TABLE "KnowledgeItem"   ALTER COLUMN "tags"           SET DEFAULT '{}';
ALTER TABLE "ClauseProposal"  ALTER COLUMN "tags"           SET DEFAULT '{}';
ALTER TABLE "EnvelopeSigner"  ALTER COLUMN "requirementIds" SET DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "CommissionCharge_orgId_kind_idx"
  ON "CommissionCharge" ("orgId", "kind");
