-- Multitenant Fase 1c — ClickSignAccount per-org (aditivo; fallback pool global). Idempotente.
CREATE TABLE IF NOT EXISTS "ClickSignAccount" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'platform_pool',
  "whiteLabelId" TEXT,
  "apiKeyCiphertext" TEXT,
  "apiKeyIv" TEXT,
  "apiKeyTag" TEXT,
  "hmacSecretCiphertext" TEXT,
  "hmacSecretIv" TEXT,
  "hmacSecretTag" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClickSignAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClickSignAccount_orgId_key" ON "ClickSignAccount"("orgId");
