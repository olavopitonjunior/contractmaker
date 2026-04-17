-- Phase C — consulta ad-hoc de certidões (CPF/CNPJ não arrolado em Deal).
-- Torna dealId opcional e adiciona orgId para escopar ad-hoc requests.

-- Drop existing FK to recreate as nullable
ALTER TABLE "CertidaoJob" DROP CONSTRAINT "CertidaoJob_dealId_fkey";

-- Make dealId nullable
ALTER TABLE "CertidaoJob" ALTER COLUMN "dealId" DROP NOT NULL;

-- Add orgId for ad-hoc jobs
ALTER TABLE "CertidaoJob" ADD COLUMN "orgId" TEXT;

-- Recreate dealId FK (now optional)
ALTER TABLE "CertidaoJob"
ADD CONSTRAINT "CertidaoJob_dealId_fkey"
FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Add orgId FK
ALTER TABLE "CertidaoJob"
ADD CONSTRAINT "CertidaoJob_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for ad-hoc batch listing
CREATE INDEX "CertidaoJob_orgId_batchId_idx" ON "CertidaoJob"("orgId", "batchId");
