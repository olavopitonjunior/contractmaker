-- DIMOB: vendas excluídas da declaração por (org, ano). Idempotente.

CREATE TABLE IF NOT EXISTS "DimobExclusion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "dealId" TEXT NOT NULL,
    "reason" TEXT,
    "excludedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DimobExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DimobExclusion_orgId_year_dealId_key" ON "DimobExclusion"("orgId", "year", "dealId");
CREATE INDEX IF NOT EXISTS "DimobExclusion_orgId_year_idx" ON "DimobExclusion"("orgId", "year");

DO $$ BEGIN
    ALTER TABLE "DimobExclusion"
        ADD CONSTRAINT "DimobExclusion_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
