-- Add preview cache fields to ContractTemplate.
-- previewSourceHash: hash of handlebarsSource used to generate the cached
-- googleTemplateDocId preview. Cleared when source changes.
-- previewUpdatedAt: timestamp of last preview regeneration.

ALTER TABLE "ContractTemplate"
  ADD COLUMN "previewSourceHash" TEXT,
  ADD COLUMN "previewUpdatedAt" TIMESTAMP(3);
