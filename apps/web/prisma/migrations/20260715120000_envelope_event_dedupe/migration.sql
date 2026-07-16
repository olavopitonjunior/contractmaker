-- Idempotência de webhook ClickSign: dedupeKey único no EnvelopeEvent.
-- Idempotente (IF NOT EXISTS) pra ser seguro em re-run / auto-mode.

ALTER TABLE "EnvelopeEvent" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "EnvelopeEvent_dedupeKey_key"
  ON "EnvelopeEvent" ("dedupeKey");
