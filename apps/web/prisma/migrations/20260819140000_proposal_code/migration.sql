-- Código sequencial da proposta: "PROP-<ano BRT>-<seq 4 dígitos>".
--
-- Até aqui o "número" da proposta era `id.slice(-8)` (sufixo do cuid), que não é
-- sequencial, não é legível e muda de forma imprevisível entre propostas
-- vizinhas. Passa a existir `Proposal.code`, alocado por um contador
-- por (org, ano) em `OrgSequence`.
--
-- Plain SQL e idempotente: `prisma migrate deploy` roda no build, e uma
-- reexecução (redeploy, branch recriada) não pode falhar.

-- 1. Contador. `value` guarda o ÚLTIMO número entregue (não o próximo).
CREATE TABLE IF NOT EXISTS "OrgSequence" (
  "orgId"     TEXT NOT NULL,
  "scope"     TEXT NOT NULL,
  "value"     INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgSequence_pkey" PRIMARY KEY ("orgId", "scope")
);

DO $$
BEGIN
  ALTER TABLE "OrgSequence"
    ADD CONSTRAINT "OrgSequence_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Coluna. Nullable no schema só por causa deste backfill.
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- 3. Backfill dos códigos.
--
-- O ano vem do fuso de São Paulo: `createdAt` é `timestamp(3)` SEM timezone
-- guardando UTC, então a conversão correta é o duplo AT TIME ZONE (o primeiro
-- rotula o valor como UTC, o segundo converte). Sem isso, uma proposta criada
-- em 31/12 às 22h BRT (= 01/01 01h UTC) cairia no ano seguinte.
--
-- ORDER BY "createdAt", "id" — o id desempata criações no mesmo milissegundo,
-- senão ROW_NUMBER() não é determinístico e uma reexecução renumeraria.
WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "orgId",
        EXTRACT(
          YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')
        )
      ORDER BY "createdAt", "id"
    ) AS n,
    EXTRACT(
      YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')
    )::int AS yr
  FROM "Proposal"
  WHERE "code" IS NULL
)
UPDATE "Proposal" p
SET "code" = 'PROP-' || n.yr::text || '-' || lpad(n.n::text, 4, '0')
FROM numbered n
WHERE p."id" = n."id";

-- 4. Semeia o contador com o ÚLTIMO número entregue por (org, ano).
--
-- Statement separado (não um `RETURNING` da CTE acima) porque roda na mesma
-- transação e é trivial de conferir: como `code` acabou de nascer, toda
-- proposta de um (org, ano) recebeu 1..COUNT(*) — então o maior sufixo É a
-- contagem. `GREATEST` mantém a idempotência se a row já existir.
INSERT INTO "OrgSequence" ("orgId", "scope", "value", "updatedAt")
SELECT
  "orgId",
  'proposal:' || EXTRACT(
    YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')
  )::int::text,
  COUNT(*)::int,
  CURRENT_TIMESTAMP
FROM "Proposal"
WHERE "code" IS NOT NULL
GROUP BY
  "orgId",
  EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'))
ON CONFLICT ("orgId", "scope") DO UPDATE
  SET "value" = GREATEST("OrgSequence"."value", EXCLUDED."value"),
      "updatedAt" = CURRENT_TIMESTAMP;

-- 5. Unicidade por org. Depois do backfill — antes dele o índice passaria, mas
-- deixar por último garante que um backfill torto falhe aqui em vez de gravar.
-- NULLs não colidem entre si no Postgres, então propostas sem código (não
-- deveria haver nenhuma) não travam o índice.
CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_orgId_code_key"
  ON "Proposal"("orgId", "code");
