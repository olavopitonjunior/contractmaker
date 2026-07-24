-- Cadastro de Corretores (feature "atualizações do processo", 2026-07).
-- (1) Preferências de notificação por corretor; (2) normalização de cpfCnpj
-- (digits-only) em kind='commissioner'; (3) dedupe de duplicatas ativas
-- mantendo a linha mais completa/antiga; (4) partial unique index que o
-- Prisma não expressa. Idempotente (deploy roda no build).

ALTER TABLE "SplitRecipient" ADD COLUMN IF NOT EXISTS "notifyByEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SplitRecipient" ADD COLUMN IF NOT EXISTS "notifyByWhatsapp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SplitRecipient" ADD COLUMN IF NOT EXISTS "notifyOptOut" BOOLEAN NOT NULL DEFAULT false;

-- (2) Normaliza cpfCnpj pra digits-only nos commissioners (re-rodável: no-op
-- quando já normalizado).
UPDATE "SplitRecipient"
SET "cpfCnpj" = regexp_replace("cpfCnpj", '\D', '', 'g')
WHERE "kind" = 'commissioner'
  AND "cpfCnpj" IS NOT NULL
  AND "cpfCnpj" ~ '\D';

-- Strings vazias pós-normalização viram NULL (não participam do unique).
UPDATE "SplitRecipient"
SET "cpfCnpj" = NULL
WHERE "kind" = 'commissioner'
  AND "cpfCnpj" = '';

-- (3) Dedupe: entre commissioners ATIVOS com mesmo (orgId, cpfCnpj), mantém a
-- linha mais "completa" (menos pendingFields) e, em empate, a mais antiga.
-- Duplicatas são DESATIVADAS (não deletadas — AsaasTransfer pode referenciar).
-- Re-rodável: segunda execução não encontra janela com rn > 1.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "orgId", "cpfCnpj"
           ORDER BY cardinality("pendingFields") ASC, "createdAt" ASC
         ) AS rn
  FROM "SplitRecipient"
  WHERE "kind" = 'commissioner'
    AND "active" = true
    AND "cpfCnpj" IS NOT NULL
)
UPDATE "SplitRecipient" sr
SET "active" = false
FROM ranked
WHERE sr.id = ranked.id
  AND ranked.rn > 1;

-- (4) Partial unique: um commissioner ativo por (orgId, cpfCnpj).
CREATE UNIQUE INDEX IF NOT EXISTS "SplitRecipient_org_cpf_active_commissioner_key"
  ON "SplitRecipient" ("orgId", "cpfCnpj")
  WHERE "kind" = 'commissioner' AND "active" = true AND "cpfCnpj" IS NOT NULL;
