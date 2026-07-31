-- Catálogo de GARANTIAS locatícias por org (tipo × garantidor).
--
-- O formulário de locação já gravava `garantia.tipo` (enum fechado) e
-- `garantia.provider` (TEXTO LIVRE — cada corretor escrevia a seguradora de um
-- jeito). Esta tabela guarda os pares que a imobiliária realmente trabalha pra
-- que o form ofereça cada um como UMA escolha ("Seguro-fiança — Porto Seguro")
-- e o `provider` saia normalizado — é por ele que a cláusula da seguradora é
-- selecionada.
--
-- Org sem row nenhuma cai nos defaults em código (seguro-fiança × Tokio Marine,
-- Porto Seguro, Pottencial, Too), então NÃO há backfill: nada muda pra quem já
-- existe até o admin cadastrar o catálogo dele.
--
-- Aditiva e idempotente (prisma migrate deploy roda no build).

CREATE TABLE IF NOT EXISTS "GarantiaOption" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "tipo"      TEXT NOT NULL,
  "provider"  TEXT NOT NULL DEFAULT '',
  "label"     TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GarantiaOption_pkey" PRIMARY KEY ("id")
);

-- Um par (tipo, garantidor) por org: duas linhas iguais virariam duas opções
-- idênticas no select do formulário público.
CREATE UNIQUE INDEX IF NOT EXISTS "GarantiaOption_orgId_tipo_provider_key"
  ON "GarantiaOption" ("orgId", "tipo", "provider");

CREATE INDEX IF NOT EXISTS "GarantiaOption_orgId_active_idx"
  ON "GarantiaOption" ("orgId", "active");

-- FK com guard: ADD CONSTRAINT não tem IF NOT EXISTS no Postgres.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'GarantiaOption_orgId_fkey'
  ) THEN
    ALTER TABLE "GarantiaOption"
      ADD CONSTRAINT "GarantiaOption_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
