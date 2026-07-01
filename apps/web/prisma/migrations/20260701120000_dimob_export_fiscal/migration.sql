-- DIMOB: campos fiscais do declarante + histórico de exports
-- Idempotente (guards IF NOT EXISTS / duplicate_object).

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "fiscalResponsibleCpf" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "fiscalUf" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "fiscalMunicipioCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "fiscalMunicipioName" TEXT;

CREATE TABLE IF NOT EXISTS "DimobExport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "totalOperacoes" DOUBLE PRECISION NOT NULL,
    "totalComissao" DOUBLE PRECISION NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fileUrl" TEXT,
    "generatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DimobExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DimobExport_orgId_year_idx" ON "DimobExport"("orgId", "year");

DO $$ BEGIN
    ALTER TABLE "DimobExport"
        ADD CONSTRAINT "DimobExport_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
