-- Add content hash for OCR cache lookup
ALTER TABLE "FormAttachment" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "FormAttachment_contentHash_idx" ON "FormAttachment"("contentHash");
