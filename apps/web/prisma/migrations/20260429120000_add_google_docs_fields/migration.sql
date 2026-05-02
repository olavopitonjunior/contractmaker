-- Phase 0 da migração para Google Docs: adiciona campos espelho aos modelos
-- principais. Não remove nada; coexiste com TipTap atrás de feature flag.

ALTER TABLE "Contract"
  ADD COLUMN "googleDocId"         TEXT,
  ADD COLUMN "googleDocUrl"        TEXT,
  ADD COLUMN "googleDocStatus"     TEXT,
  ADD COLUMN "googleWatchChannel"  TEXT,
  ADD COLUMN "googleWatchResource" TEXT,
  ADD COLUMN "googleWatchExpires"  TIMESTAMP(3);

ALTER TABLE "ContractTemplate"
  ADD COLUMN "googleTemplateDocId" TEXT;

ALTER TABLE "ContractComment"
  ADD COLUMN "googleCommentId" TEXT;

ALTER TABLE "ContractSuggestion"
  ADD COLUMN "googleSuggestionId" TEXT;

CREATE UNIQUE INDEX "Contract_googleDocId_key"
  ON "Contract"("googleDocId")
  WHERE "googleDocId" IS NOT NULL;

CREATE INDEX "ContractComment_googleCommentId_idx"
  ON "ContractComment"("googleCommentId");

CREATE INDEX "ContractSuggestion_googleSuggestionId_idx"
  ON "ContractSuggestion"("googleSuggestionId");
