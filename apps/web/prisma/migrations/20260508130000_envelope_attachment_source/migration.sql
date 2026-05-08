-- Allow envelopes to come from either a Contract (CCV path) or a raw DealAttachment
-- (avulso path: aditivos, distratos, procurações, recibos). Aditive — existing rows
-- keep contractId set, source='contract'.
ALTER TABLE "Envelope" ALTER COLUMN "contractId" DROP NOT NULL;
ALTER TABLE "Envelope" ADD COLUMN "attachmentId" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'contract';

ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "DealAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Envelope_attachmentId_idx" ON "Envelope"("attachmentId");

-- XOR: exatamente uma das duas FKs deve estar populada por envelope.
ALTER TABLE "Envelope" ADD CONSTRAINT "envelope_source_xor"
  CHECK (
    ("contractId" IS NOT NULL AND "attachmentId" IS NULL) OR
    ("contractId" IS NULL AND "attachmentId" IS NOT NULL)
  );
