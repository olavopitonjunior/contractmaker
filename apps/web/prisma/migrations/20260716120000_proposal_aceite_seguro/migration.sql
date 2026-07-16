-- Aceite via WhatsApp seguro: rastreio por signatário + snapshot congelado.
-- Idempotente.

-- Rastreio do acceptance_term por signatário (antes só o 1º ficava na Proposal).
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptanceClicksignId" TEXT;
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptanceStatus" TEXT;
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "ProposalSigner" ADD COLUMN IF NOT EXISTS "refusedAt" TIMESTAMP(3);

-- O índice UNIQUE já serve os lookups por igualdade — não há @@index separado
-- (seria redundante, dobrando a amplificação de escrita na coluna).
CREATE UNIQUE INDEX IF NOT EXISTS "ProposalSigner_acceptanceClicksignId_key"
  ON "ProposalSigner" ("acceptanceClicksignId");

-- Snapshot congelado do documento enviado (valor probatório do aceite).
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sentSnapshotHtml" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sentSnapshotHash" TEXT;
