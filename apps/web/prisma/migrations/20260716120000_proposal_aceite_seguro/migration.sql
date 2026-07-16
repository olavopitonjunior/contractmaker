-- Aceite via WhatsApp seguro: rastreio por signatário + snapshot congelado.
-- Idempotente.

-- Rastreio do acceptance_term por signatário (antes só o 1º ficava na Proposal).
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptanceClicksignId" TEXT;
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptanceStatus" TEXT;
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "refusedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "ProposalSigner_acceptanceClicksignId_key"
  ON "ProposalSigner" ("acceptanceClicksignId");
CREATE INDEX IF NOT EXISTS "ProposalSigner_acceptanceClicksignId_idx"
  ON "ProposalSigner" ("acceptanceClicksignId");

-- Snapshot congelado do documento enviado (valor probatório do aceite).
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sentSnapshotHtml" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sentSnapshotHash" TEXT;
