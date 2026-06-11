-- OrgModule (Modularização) — entitlements de módulos (Vendas/Locação) por tenant.
-- Aditivo. Idempotente (re-rodável). Backfill liga AMBOS os módulos em toda org
-- existente, preservando o comportamento atual (ninguém perde acesso).

CREATE TABLE IF NOT EXISTS "OrgModule" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "featureFlags" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "OrgModule_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX "OrgModule_orgId_module_key" ON "OrgModule"("orgId", "module");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "OrgModule_orgId_idx" ON "OrgModule"("orgId");

DO $$ BEGIN
  ALTER TABLE "OrgModule" ADD CONSTRAINT "OrgModule_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: toda org recebe os módulos "vendas" e "locacao" habilitados.
INSERT INTO "OrgModule" ("id", "orgId", "module", "enabled", "featureFlags", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", m.module, true, '{}'::jsonb, NOW(), NOW()
FROM "Organization" o
CROSS JOIN (VALUES ('vendas'), ('locacao')) AS m(module)
ON CONFLICT ("orgId", "module") DO NOTHING;
