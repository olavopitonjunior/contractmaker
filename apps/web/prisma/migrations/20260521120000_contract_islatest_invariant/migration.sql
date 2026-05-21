-- C1 (QA deal 20486): invariante "no máximo um Contract.isLatest=true por deal".
-- Em prod havia 2 linhas "Versão 2" com isLatest=true no mesmo deal (criação
-- concorrente de versão sem transação). Este migration:
--   1. Conserta os dados: mantém isLatest=true só na MAIOR versão por dealId
--      (desempate pela createdAt mais recente), zera as demais.
--   2. Cria índice único parcial pra impedir a recorrência no nível do banco.

-- 1. Data fix (idempotente)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "dealId"
      ORDER BY version DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "Contract"
)
UPDATE "Contract" c
SET "isLatest" = (r.rn = 1)
FROM ranked r
WHERE c.id = r.id
  AND c."isLatest" <> (r.rn = 1);

-- 2. Enforce no nível do banco: no máximo uma linha isLatest=true por deal.
--    O guard transacional em generateContractForDeal faz updateMany(false)
--    ANTES do create(true), então a constraint (não-deferida) é satisfeita;
--    criações concorrentes colidem aqui e uma falha/retry — comportamento desejado.
CREATE UNIQUE INDEX IF NOT EXISTS "Contract_dealId_isLatest_unique"
  ON "Contract" ("dealId")
  WHERE "isLatest" = true;
