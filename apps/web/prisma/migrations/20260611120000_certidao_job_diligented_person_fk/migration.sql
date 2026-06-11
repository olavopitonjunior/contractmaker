-- CertidaoJob ganha uma âncora estável pro alvo "diligenciado": FK pra
-- DiligentedPerson. Antes a ligação era posicional (targetKind+targetIndex), que
-- desliza quando uma pessoa do meio é removida — guard de exclusão e supersede de
-- re-emissão miravam a pessoa errada. ON DELETE SET NULL preserva o histórico do
-- job (não cascateia) se a pessoa for removida.

-- 1) coluna nullable (idempotente)
ALTER TABLE "CertidaoJob" ADD COLUMN IF NOT EXISTS "diligentedPersonId" TEXT;

-- 2) backfill: liga jobs de diligenciado existentes à pessoa pela posição atual
--    (row_number-1 == targetIndex). Para deals sem remoção de diligenciado, é
--    exato; para os que já sofreram drift, é o melhor mapeamento possível.
UPDATE "CertidaoJob" cj
SET "diligentedPersonId" = sub.id
FROM (
  SELECT dp.id,
         dp."dealId",
         (row_number() OVER (PARTITION BY dp."dealId" ORDER BY dp."createdAt" ASC) - 1) AS idx
  FROM "DiligentedPerson" dp
) sub
WHERE cj."targetKind" = 'diligenciado'
  AND cj."dealId" = sub."dealId"
  AND cj."targetIndex" = sub.idx
  AND cj."diligentedPersonId" IS NULL;

-- 3) FK ON DELETE SET NULL (idempotente — só cria se ainda não existe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CertidaoJob_diligentedPersonId_fkey'
  ) THEN
    ALTER TABLE "CertidaoJob"
      ADD CONSTRAINT "CertidaoJob_diligentedPersonId_fkey"
      FOREIGN KEY ("diligentedPersonId") REFERENCES "DiligentedPerson"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) índice pra lookup por (deal, pessoa)
CREATE INDEX IF NOT EXISTS "CertidaoJob_dealId_diligentedPersonId_idx"
  ON "CertidaoJob"("dealId", "diligentedPersonId");
