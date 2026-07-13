-- Locação — ambiente de Clientes (prospects) + análise de crédito/fiança.
-- Aditivo e idempotente (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- guards de constraint por pg_constraint). Ver plano project_locacao_clientes.

-- ── Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeaseClient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tipoPessoa" TEXT NOT NULL DEFAULT 'fisica',
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "crmId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'novo',
    "dataJson" JSONB,
    "complianceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaseClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaseClientAttachment" (
    "id" TEXT NOT NULL,
    "leaseClientId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "contentHash" TEXT,
    "byteSize" INTEGER,
    "certidaoJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaseClientAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaseClientInsurerAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leaseClientId" TEXT NOT NULL,
    "seguradora" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "premioMensal" DOUBLE PRECISION,
    "resultJson" JSONB,
    "externalRef" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaseClientInsurerAnalysis_pkey" PRIMARY KEY ("id")
);

-- ── Coluna nova em CertidaoJob (job escopado a um LeaseClient) ───────────────
ALTER TABLE "CertidaoJob" ADD COLUMN IF NOT EXISTS "leaseClientId" TEXT;

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "LeaseClient_orgId_createdAt_idx" ON "LeaseClient"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeaseClient_orgId_status_idx" ON "LeaseClient"("orgId", "status");
CREATE INDEX IF NOT EXISTS "LeaseClient_orgId_cpfCnpj_idx" ON "LeaseClient"("orgId", "cpfCnpj");
CREATE INDEX IF NOT EXISTS "LeaseClientAttachment_leaseClientId_idx" ON "LeaseClientAttachment"("leaseClientId");
CREATE INDEX IF NOT EXISTS "LeaseClientAttachment_contentHash_idx" ON "LeaseClientAttachment"("contentHash");
CREATE INDEX IF NOT EXISTS "LeaseClientAttachment_certidaoJobId_idx" ON "LeaseClientAttachment"("certidaoJobId");
CREATE INDEX IF NOT EXISTS "LeaseClientInsurerAnalysis_leaseClientId_idx" ON "LeaseClientInsurerAnalysis"("leaseClientId");
CREATE INDEX IF NOT EXISTS "LeaseClientInsurerAnalysis_orgId_idx" ON "LeaseClientInsurerAnalysis"("orgId");
CREATE INDEX IF NOT EXISTS "CertidaoJob_leaseClientId_batchId_idx" ON "CertidaoJob"("leaseClientId", "batchId");

-- ── Foreign keys (guardadas por pg_constraint pra idempotência) ─────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClient_orgId_fkey') THEN
    ALTER TABLE "LeaseClient" ADD CONSTRAINT "LeaseClient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClient_createdByUserId_fkey') THEN
    ALTER TABLE "LeaseClient" ADD CONSTRAINT "LeaseClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClientAttachment_leaseClientId_fkey') THEN
    ALTER TABLE "LeaseClientAttachment" ADD CONSTRAINT "LeaseClientAttachment_leaseClientId_fkey" FOREIGN KEY ("leaseClientId") REFERENCES "LeaseClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClientInsurerAnalysis_orgId_fkey') THEN
    ALTER TABLE "LeaseClientInsurerAnalysis" ADD CONSTRAINT "LeaseClientInsurerAnalysis_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClientInsurerAnalysis_leaseClientId_fkey') THEN
    ALTER TABLE "LeaseClientInsurerAnalysis" ADD CONSTRAINT "LeaseClientInsurerAnalysis_leaseClientId_fkey" FOREIGN KEY ("leaseClientId") REFERENCES "LeaseClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseClientInsurerAnalysis_createdByUserId_fkey') THEN
    ALTER TABLE "LeaseClientInsurerAnalysis" ADD CONSTRAINT "LeaseClientInsurerAnalysis_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CertidaoJob_leaseClientId_fkey') THEN
    ALTER TABLE "CertidaoJob" ADD CONSTRAINT "CertidaoJob_leaseClientId_fkey" FOREIGN KEY ("leaseClientId") REFERENCES "LeaseClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
