-- OrgFormSettings: configuração de obrigatoriedade dos campos do
-- formulário público /f/[token] por organização.
--
-- preset = "legado" preserva STEP_REQUIRED_FIELDS hardcoded original
-- pra não quebrar orgs existentes. customRequiredPaths é JSON array
-- de paths extras (ex: ["vendedores.0.rg", "compradores.0.data_nascimento"]).
--
-- Idempotente (IF NOT EXISTS) — single-tenant prod sem homolog roda
-- "migrate deploy" direto, rerun deve ser no-op.

CREATE TABLE IF NOT EXISTS "OrgFormSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'legado',
    "customRequiredPaths" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgFormSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgFormSettings_orgId_key" ON "OrgFormSettings"("orgId");

ALTER TABLE "OrgFormSettings"
    DROP CONSTRAINT IF EXISTS "OrgFormSettings_orgId_fkey";

ALTER TABLE "OrgFormSettings"
    ADD CONSTRAINT "OrgFormSettings_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
