-- Phase F.I-α — OCR fila assíncrona via status enum.

ALTER TABLE "FormAttachment"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "extractError" TEXT;

-- Backfill: rows com extractedData já populado são "ready"
UPDATE "FormAttachment"
SET "status" = 'ready'
WHERE "extractedData" IS NOT NULL;

CREATE INDEX "FormAttachment_status_createdAt_idx"
ON "FormAttachment"("status", "createdAt");
