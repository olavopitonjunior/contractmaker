-- Multitenant Fase 1b — GoogleConnection per-org (aditivo; fallback SA global). Idempotente.
CREATE TABLE IF NOT EXISTS "GoogleConnection" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "connectionType" TEXT NOT NULL DEFAULT 'personal_oauth',
  "refreshTokenCiphertext" TEXT,
  "refreshTokenIv" TEXT,
  "refreshTokenTag" TEXT,
  "driveRootFolderId" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "workspaceDomain" TEXT,
  "adminUserEmail" TEXT,
  "lastRefreshAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleConnection_orgId_key" ON "GoogleConnection"("orgId");
