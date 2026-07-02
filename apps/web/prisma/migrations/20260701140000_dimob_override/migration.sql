-- DIMOB: edições do usuário na grade (overrides por org+ano). Idempotente.

CREATE TABLE IF NOT EXISTS "DimobOverride" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DimobOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DimobOverride_orgId_year_key" ON "DimobOverride"("orgId", "year");

DO $$ BEGIN
    ALTER TABLE "DimobOverride"
        ADD CONSTRAINT "DimobOverride_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
