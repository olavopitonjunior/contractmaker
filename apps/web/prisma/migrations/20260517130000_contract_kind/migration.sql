-- Contract.kind discrimina natureza do instrumento:
--   "contract"  → CCV original (padrão pra retrocompat de toda row existente)
--   "addendum"  → aditamento contratual (parentContractId aponta pro CCV)
--   "distrato"  → reservado pra fluxo futuro
--
-- parentContractId já existe pra versionamento — quando kind="addendum",
-- aponta pro CCV original ao invés da versão anterior do mesmo instrumento.
-- Index acelera "liste contratos do deal por tipo" (aba Contratos).
--
-- Migration aditiva: NOT NULL + DEFAULT garante zero impacto em inserts
-- existentes que omitem a coluna.

ALTER TABLE "Contract"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'contract';

CREATE INDEX IF NOT EXISTS "Contract_dealId_kind_isLatest_idx"
  ON "Contract"("dealId", "kind", "isLatest");
