-- Handoff comprador→proprietário com decisão humana (plano 2026-08-06, PR 2.2).
-- Idempotente (deploy roda no build). Sem backfill: propostas em voo mantêm o
-- comportamento documentado no PR (as já em aguardando_vendedor seguem o fluxo
-- antigo; as que fecharem a 1ª via após o deploy param na decisão).

ALTER TABLE "OrgSignatureSettings"
  ADD COLUMN IF NOT EXISTS "proposalAutoChainVendedor" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrgSignatureSettings"
  ADD COLUMN IF NOT EXISTS "proposalOwnerDeadlineDays" INTEGER;

ALTER TABLE "Proposal"
  ADD COLUMN IF NOT EXISTS "vendedorDeadlineAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Proposal_orgId_kind_status_idx"
  ON "Proposal" ("orgId", "kind", "status");
