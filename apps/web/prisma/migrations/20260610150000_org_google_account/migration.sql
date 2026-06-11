-- Conta Google por org (OAuth offline; refresh token AES-256-GCM) + relatório
-- do pass de IA na ingestão DOCX→template. Aditivo e idempotente.

CREATE TABLE IF NOT EXISTS "OrgGoogleAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "refreshTokenIvBase64" TEXT NOT NULL,
    "refreshTokenTagBase64" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastErrorMessage" TEXT,
    "driveFolderId" TEXT,
    "connectedById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgGoogleAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgGoogleAccount_orgId_key" ON "OrgGoogleAccount"("orgId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'OrgGoogleAccount_orgId_fkey'
  ) THEN
    ALTER TABLE "OrgGoogleAccount"
      ADD CONSTRAINT "OrgGoogleAccount_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "draftReport" JSONB;
