-- DealAttachment: contentHash + índices para dedupe por conteúdo e performance.
-- Sem @@unique dura (decisão de projeto): a dedupe fica no código, evitando 500
-- em corrida webhook×cron e em linhas legadas duplicadas. Idempotente.

ALTER TABLE "DealAttachment" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

CREATE INDEX IF NOT EXISTS "DealAttachment_dealId_idx" ON "DealAttachment"("dealId");
CREATE INDEX IF NOT EXISTS "DealAttachment_dealId_category_idx" ON "DealAttachment"("dealId", "category");
CREATE INDEX IF NOT EXISTS "DealAttachment_contentHash_idx" ON "DealAttachment"("contentHash");
