-- DIMOB: exclusões passam a suportar locação (leaseId) além de venda (dealId). Idempotente.

ALTER TABLE "DimobExclusion" ALTER COLUMN "dealId" DROP NOT NULL;
ALTER TABLE "DimobExclusion" ADD COLUMN IF NOT EXISTS "leaseId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "DimobExclusion_orgId_year_leaseId_key" ON "DimobExclusion"("orgId", "year", "leaseId");
