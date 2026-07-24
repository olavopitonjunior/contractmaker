-- Pesquisas de satisfação (NPS/CSAT): SurveyTemplate (lote imutável),
-- SurveyAutomation (regra de disparo), SurveyInvite (envio/link), SurveyResponse.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS + ADD CONSTRAINT condicionais.

CREATE TABLE IF NOT EXISTS "SurveyTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "parentVersionId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "questionsJson" JSONB NOT NULL,
    "settingsJson" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SurveyAutomation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateFamilyId" TEXT NOT NULL,
    "dealKind" TEXT NOT NULL,
    "triggerStageName" TEXT NOT NULL,
    "audience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" TEXT NOT NULL DEFAULT 'email',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderOffsetsDays" INTEGER[] DEFAULT ARRAY[2, 5]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SurveyInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "automationId" TEXT,
    "dealId" TEXT,
    "recipientRole" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "channel" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExp" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SurveyResponse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "dealId" TEXT,
    "respondentRole" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "npsScore" INTEGER,
    "csatScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE INDEX IF NOT EXISTS "SurveyTemplate_orgId_familyId_version_idx" ON "SurveyTemplate"("orgId", "familyId", "version");
CREATE INDEX IF NOT EXISTS "SurveyTemplate_orgId_isLatest_status_idx" ON "SurveyTemplate"("orgId", "isLatest", "status");

-- Invariante de lote: no máx 1 isLatest=true por (orgId, familyId).
-- Espelha Contract_dealId_kind_isLatest_unique (índice único parcial).
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyTemplate_familyId_isLatest_unique"
  ON "SurveyTemplate" ("orgId", "familyId") WHERE "isLatest" = true;

CREATE INDEX IF NOT EXISTS "SurveyAutomation_orgId_dealKind_triggerStageName_enabled_idx" ON "SurveyAutomation"("orgId", "dealKind", "triggerStageName", "enabled");

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyInvite_token_key" ON "SurveyInvite"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyInvite_dedupeKey_key" ON "SurveyInvite"("dedupeKey");
CREATE INDEX IF NOT EXISTS "SurveyInvite_orgId_templateId_status_idx" ON "SurveyInvite"("orgId", "templateId", "status");
CREATE INDEX IF NOT EXISTS "SurveyInvite_dealId_createdAt_idx" ON "SurveyInvite"("dealId", "createdAt");
CREATE INDEX IF NOT EXISTS "SurveyInvite_status_sentAt_idx" ON "SurveyInvite"("status", "sentAt");

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyResponse_inviteId_key" ON "SurveyResponse"("inviteId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_orgId_templateId_createdAt_idx" ON "SurveyResponse"("orgId", "templateId", "createdAt");
CREATE INDEX IF NOT EXISTS "SurveyResponse_dealId_idx" ON "SurveyResponse"("dealId");

-- FKs (condicionais pra idempotência)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyTemplate_orgId_fkey') THEN
    ALTER TABLE "SurveyTemplate" ADD CONSTRAINT "SurveyTemplate_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyTemplate_parentVersionId_fkey') THEN
    ALTER TABLE "SurveyTemplate" ADD CONSTRAINT "SurveyTemplate_parentVersionId_fkey"
      FOREIGN KEY ("parentVersionId") REFERENCES "SurveyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyAutomation_orgId_fkey') THEN
    ALTER TABLE "SurveyAutomation" ADD CONSTRAINT "SurveyAutomation_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyInvite_orgId_fkey') THEN
    ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyInvite_templateId_fkey') THEN
    ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "SurveyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyInvite_dealId_fkey') THEN
    ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyResponse_orgId_fkey') THEN
    ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyResponse_templateId_fkey') THEN
    ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "SurveyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyResponse_inviteId_fkey') THEN
    ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_inviteId_fkey"
      FOREIGN KEY ("inviteId") REFERENCES "SurveyInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
