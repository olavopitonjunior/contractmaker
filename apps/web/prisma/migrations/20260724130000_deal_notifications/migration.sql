-- Notificações do processo (2026-07): settings da org + log de envios
-- externos + override por deal. Idempotente (deploy roda no build).

CREATE TABLE IF NOT EXISTS "OrgNotificationSettings" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrgNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgNotificationSettings_orgId_key"
  ON "OrgNotificationSettings" ("orgId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrgNotificationSettings_orgId_fkey'
  ) THEN
    ALTER TABLE "OrgNotificationSettings"
      ADD CONSTRAINT "OrgNotificationSettings_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DealNotificationLog" (
  "id"             TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "dealId"         TEXT NOT NULL,
  "event"          TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "audience"       TEXT NOT NULL DEFAULT 'broker',
  "recipientKey"   TEXT NOT NULL,
  "recipientLabel" TEXT,
  "dedupeKey"      TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'sent',
  "detail"         JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealNotificationLog_dedupe_key"
  ON "DealNotificationLog" ("dealId", "event", "channel", "recipientKey", "dedupeKey");

CREATE INDEX IF NOT EXISTS "DealNotificationLog_orgId_dealId_createdAt_idx"
  ON "DealNotificationLog" ("orgId", "dealId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DealNotificationLog_orgId_fkey'
  ) THEN
    ALTER TABLE "DealNotificationLog"
      ADD CONSTRAINT "DealNotificationLog_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DealNotificationLog_dealId_fkey'
  ) THEN
    ALTER TABLE "DealNotificationLog"
      ADD CONSTRAINT "DealNotificationLog_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "notificationsJson" JSONB;
