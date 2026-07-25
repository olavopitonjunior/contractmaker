-- Canal "notificação do sistema → WhatsApp (Newton)" para USUÁRIOS da
-- plataforma: preferências por (user, org) + log/chokepoint de idempotência
-- sem âncora em Deal. Idempotente (migrate deploy roda no build).
--
-- Sem backfill de propósito: o default é opt-out, então a tabela de
-- preferências nascer vazia É o comportamento correto (ninguém recebe
-- WhatsApp até consentir explicitamente).

CREATE TABLE IF NOT EXISTS "UserNotificationPreference" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "settingsJson"    JSONB NOT NULL DEFAULT '{}',
  "whatsappOptInAt" TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotificationPreference_userId_orgId_key"
  ON "UserNotificationPreference" ("userId", "orgId");

CREATE INDEX IF NOT EXISTS "UserNotificationPreference_orgId_idx"
  ON "UserNotificationPreference" ("orgId");

CREATE TABLE IF NOT EXISTS "UserNotificationDelivery" (
  "id"             TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "notificationId" TEXT,
  "type"           TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
  "dedupeKey"      TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "detail"         JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt"      TIMESTAMP(3),
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"  TIMESTAMP(3),
  CONSTRAINT "UserNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- Colunas de retomada: idempotente também para bancos que já receberam a
-- versão anterior desta migration (staging pode ter aplicado antes do fix).
ALTER TABLE "UserNotificationDelivery"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserNotificationDelivery"
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotificationDelivery_dedupe_key"
  ON "UserNotificationDelivery" ("userId", "channel", "dedupeKey");

CREATE INDEX IF NOT EXISTS "UserNotificationDelivery_orgId_createdAt_idx"
  ON "UserNotificationDelivery" ("orgId", "createdAt");

CREATE INDEX IF NOT EXISTS "UserNotificationDelivery_notificationId_idx"
  ON "UserNotificationDelivery" ("notificationId");

CREATE INDEX IF NOT EXISTS "UserNotificationDelivery_userId_status_createdAt_idx"
  ON "UserNotificationDelivery" ("userId", "status", "createdAt");

-- Repesca do sweep: entregas re-tentáveis (deferred/failed/pending órfão).
CREATE INDEX IF NOT EXISTS "UserNotificationDelivery_status_lastAttemptAt_idx"
  ON "UserNotificationDelivery" ("status", "lastAttemptAt");

-- Sweep varre `type IN (allowlist) AND createdAt >= now()-30min`; os índices
-- existentes de Notification começam por orgId/userId e não atendem.
CREATE INDEX IF NOT EXISTS "Notification_type_createdAt_idx"
  ON "Notification" ("type", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserNotificationPreference_userId_fkey'
  ) THEN
    ALTER TABLE "UserNotificationPreference"
      ADD CONSTRAINT "UserNotificationPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserNotificationPreference_orgId_fkey'
  ) THEN
    ALTER TABLE "UserNotificationPreference"
      ADD CONSTRAINT "UserNotificationPreference_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserNotificationDelivery_userId_fkey'
  ) THEN
    ALTER TABLE "UserNotificationDelivery"
      ADD CONSTRAINT "UserNotificationDelivery_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserNotificationDelivery_orgId_fkey'
  ) THEN
    ALTER TABLE "UserNotificationDelivery"
      ADD CONSTRAINT "UserNotificationDelivery_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
