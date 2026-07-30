-- Categorias de TERCEIRO nos links por parte do formulário público.
--
-- Os 5 papéis nativos (vendedor/comprador; locador/locatario/fiador) continuam
-- fechados em código. Esta tabela guarda as categorias CUSTOMIZÁVEIS por org
-- (interveniente anuente, gestor do condomínio, procurador externo…) e as
-- definições de campo que cada uma coleta.
--
-- Nada muda em SalesFormParticipant: `role` já é TEXT sem enum, então o valor
-- "terceiro:<slug>" cabe sem migration de dados. As respostas vão pra
-- SalesForm.dataJson.terceiros.<slug>[] — namespace aditivo, sem colisão com os
-- schemas de venda ou locação.
--
-- Aditiva e idempotente (prisma migrate deploy roda no build).

CREATE TABLE IF NOT EXISTS "FormParticipantCategory" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "appliesTo"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fields"      JSONB NOT NULL DEFAULT '[]',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormParticipantCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FormParticipantCategory_orgId_slug_key"
  ON "FormParticipantCategory" ("orgId", "slug");

CREATE INDEX IF NOT EXISTS "FormParticipantCategory_orgId_active_idx"
  ON "FormParticipantCategory" ("orgId", "active");

-- FK com guard: ADD CONSTRAINT não tem IF NOT EXISTS no Postgres.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FormParticipantCategory_orgId_fkey'
  ) THEN
    ALTER TABLE "FormParticipantCategory"
      ADD CONSTRAINT "FormParticipantCategory_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
