-- Multitenant Fase 1a — subdomínio per-tenant + BrandingSettings. Idempotente.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "subdomain" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "customDomain" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_subdomain_key" ON "Organization"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_customDomain_key" ON "Organization"("customDomain");

CREATE TABLE IF NOT EXISTS "BrandingSettings" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "logoUrl" TEXT,
  "faviconUrl" TEXT,
  "primaryColor" TEXT,
  "secondaryColor" TEXT,
  "emailHeader" TEXT,
  "emailFooter" TEXT,
  "poweredBy" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandingSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BrandingSettings_orgId_key" ON "BrandingSettings"("orgId");

DO $$ BEGIN
  ALTER TABLE "BrandingSettings" ADD CONSTRAINT "BrandingSettings_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
