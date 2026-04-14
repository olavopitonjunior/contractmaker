-- AlterTable: DealAttachment gains extractedData + source
ALTER TABLE "DealAttachment"
  ADD COLUMN "extractedData" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable: CertidaoJob tracks each certidão extraction attempt
CREATE TABLE "CertidaoJob" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'infosimples',
    "endpoint" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetIndex" INTEGER NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultCode" INTEGER,
    "resultMessage" TEXT,
    "resultData" JSONB,
    "attachmentId" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "costCents" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expectedReadyAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertidaoJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertidaoJob_dealId_batchId_idx" ON "CertidaoJob"("dealId", "batchId");
CREATE INDEX "CertidaoJob_status_idx" ON "CertidaoJob"("status");
CREATE INDEX "CertidaoJob_status_expectedReadyAt_idx" ON "CertidaoJob"("status", "expectedReadyAt");

-- AddForeignKey
ALTER TABLE "CertidaoJob" ADD CONSTRAINT "CertidaoJob_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CertidaoJob" ADD CONSTRAINT "CertidaoJob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "DealAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
