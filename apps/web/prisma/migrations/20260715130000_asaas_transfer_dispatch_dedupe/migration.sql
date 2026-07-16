-- Idempotência de dispatch de split PIX: dispatchDedupeKey único.
-- O @@unique([commissionChargeId, splitRecipientId]) não protege PIX externo
-- (splitRecipientId NULL → NULLs distintos), então split_dispatch podia pagar 2×.
-- Backfill dedupe-safe: se já existem duplicatas em prod, só a linha mais antiga
-- de cada grupo recebe a chave; as demais ficam NULL (índice único aceita NULLs)
-- pra não travar a criação do índice. Idempotente.

ALTER TABLE "AsaasTransfer" ADD COLUMN IF NOT EXISTS "dispatchDedupeKey" TEXT;

WITH ranked AS (
  SELECT
    "id",
    "commissionChargeId" || ':' ||
      COALESCE("splitRecipientId", 'ext:' || COALESCE("pixAddressKey", "id")) AS k,
    ROW_NUMBER() OVER (
      PARTITION BY
        "commissionChargeId" || ':' ||
        COALESCE("splitRecipientId", 'ext:' || COALESCE("pixAddressKey", "id"))
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "AsaasTransfer"
  WHERE "origin" = 'split_dispatch'
    AND "commissionChargeId" IS NOT NULL
    AND "dispatchDedupeKey" IS NULL
)
UPDATE "AsaasTransfer" t
SET "dispatchDedupeKey" = ranked.k
FROM ranked
WHERE t."id" = ranked."id" AND ranked.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS "AsaasTransfer_dispatchDedupeKey_key"
  ON "AsaasTransfer" ("dispatchDedupeKey");
