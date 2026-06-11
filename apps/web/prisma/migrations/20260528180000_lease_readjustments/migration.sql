-- Lease readjustments (Fase 2) — histórico de reajustes + dataProximoReajuste
-- Aditivo. Idempotente.

ALTER TABLE "LeaseContract"
  ADD COLUMN IF NOT EXISTS "dataProximoReajuste" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "LeaseContract_orgId_dataProximoReajuste_idx"
  ON "LeaseContract" ("orgId", "dataProximoReajuste");

CREATE TABLE IF NOT EXISTS "LeaseReadjustment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT NOT NULL,
  "dataReajuste" TIMESTAMP(3) NOT NULL,
  "indice" TEXT NOT NULL,
  "percentualAplicado" DOUBLE PRECISION NOT NULL,
  "valorAnterior" DOUBLE PRECISION NOT NULL,
  "valorNovo" DOUBLE PRECISION NOT NULL,
  "observacao" TEXT,
  "status" TEXT NOT NULL DEFAULT 'proposto',
  "propostoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aprovadoEm" TIMESTAMP(3),
  "aprovadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaseReadjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeaseReadjustment_orgId_status_idx"
  ON "LeaseReadjustment" ("orgId", "status");
CREATE INDEX IF NOT EXISTS "LeaseReadjustment_leaseContractId_dataReajuste_idx"
  ON "LeaseReadjustment" ("leaseContractId", "dataReajuste");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseReadjustment_orgId_fkey') THEN
    ALTER TABLE "LeaseReadjustment" ADD CONSTRAINT "LeaseReadjustment_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseReadjustment_leaseContractId_fkey') THEN
    ALTER TABLE "LeaseReadjustment" ADD CONSTRAINT "LeaseReadjustment_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
