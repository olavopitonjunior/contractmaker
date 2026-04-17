-- Add idempotent OCR lock column to FormAttachment.
-- Used by the extract routes to atomically claim the right to call Gemini,
-- preventing two concurrent POSTs from both calling the OCR API for the
-- same attachment. Cleared on failure so the user can retry.

ALTER TABLE "FormAttachment"
ADD COLUMN "extractingStartedAt" TIMESTAMP(3);

CREATE INDEX "FormAttachment_extractingStartedAt_idx"
ON "FormAttachment"("extractingStartedAt");
