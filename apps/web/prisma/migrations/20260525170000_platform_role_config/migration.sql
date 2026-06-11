-- Multitenant Fase 0a — identidade de plataforma (super-admin) + config global.
-- Idempotente (IF NOT EXISTS + ON CONFLICT) seguindo a convenção do repo.

-- PlatformRole: staff cross-tenant (super_admin | support | billing).
CREATE TABLE IF NOT EXISTS "PlatformRole" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformRole_userId_key" ON "PlatformRole"("userId");
CREATE INDEX IF NOT EXISTS "PlatformRole_role_idx" ON "PlatformRole"("role");

DO $$ BEGIN
  ALTER TABLE "PlatformRole" ADD CONSTRAINT "PlatformRole_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PlatformConfig: singleton de taxas/markup globais.
CREATE TABLE IF NOT EXISTS "PlatformConfig" (
  "id" TEXT NOT NULL,
  "singletonKey" TEXT NOT NULL DEFAULT 'singleton',
  "asaasParentAccountId" TEXT,
  "defaultPlatformFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "defaultBoletoFeeCents" INTEGER NOT NULL DEFAULT 0,
  "defaultPixFeeCents" INTEGER NOT NULL DEFAULT 0,
  "defaultCardFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "defaultPayLinkExpiryDays" INTEGER NOT NULL DEFAULT 30,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformConfig_singletonKey_key" ON "PlatformConfig"("singletonKey");

-- PlatformConfigHistory: trilha de mudanças do singleton.
CREATE TABLE IF NOT EXISTS "PlatformConfigHistory" (
  "id" TEXT NOT NULL,
  "configSnapshot" JSONB NOT NULL,
  "changedBy" TEXT,
  "changeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformConfigHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlatformConfigHistory_createdAt_idx" ON "PlatformConfigHistory"("createdAt");

-- Seed idempotente do singleton (id estável; defaults zerados até Fase 1d).
INSERT INTO "PlatformConfig" ("id", "singletonKey", "updatedAt")
VALUES ('platform_config_singleton', 'singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("singletonKey") DO NOTHING;
