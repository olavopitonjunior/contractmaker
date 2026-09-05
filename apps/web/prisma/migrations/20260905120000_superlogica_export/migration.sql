-- Exportação de vendas para a Superlógica: links id local → id remoto (idempotência
-- e retomada) e o registro da exportação por negócio. Idempotente (IF NOT EXISTS),
-- como as migrations irmãs (superlogica_account, clicksign_multitenant).

CREATE TABLE IF NOT EXISTS "SuperlogicaLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "localKey" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "remoteAux" TEXT,
    "snapshotJson" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperlogicaLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuperlogicaLink_orgId_entityType_localKey_key"
    ON "SuperlogicaLink"("orgId", "entityType", "localKey");
CREATE INDEX IF NOT EXISTS "SuperlogicaLink_orgId_entityType_remoteId_idx"
    ON "SuperlogicaLink"("orgId", "entityType", "remoteId");

CREATE TABLE IF NOT EXISTS "SuperlogicaExport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "vendaId" TEXT,
    "payloadHash" TEXT,
    "payloadJson" JSONB,
    "responseJson" JSONB,
    "warningsJson" JSONB,
    "lastError" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperlogicaExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuperlogicaExport_dealId_key" ON "SuperlogicaExport"("dealId");
CREATE INDEX IF NOT EXISTS "SuperlogicaExport_orgId_status_idx" ON "SuperlogicaExport"("orgId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperlogicaLink_orgId_fkey') THEN
    ALTER TABLE "SuperlogicaLink"
      ADD CONSTRAINT "SuperlogicaLink_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperlogicaExport_orgId_fkey') THEN
    ALTER TABLE "SuperlogicaExport"
      ADD CONSTRAINT "SuperlogicaExport_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuperlogicaExport_dealId_fkey') THEN
    ALTER TABLE "SuperlogicaExport"
      ADD CONSTRAINT "SuperlogicaExport_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
