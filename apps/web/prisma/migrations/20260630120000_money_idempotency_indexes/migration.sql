-- Idempotência do caminho de dinheiro (Fase 1 da auditoria 2026-06).
-- Prisma @@unique não suporta índice parcial (WHERE), então vão como SQL raw —
-- mesmo padrão dos índices pgvector deste repo. migrate deploy não checa drift.

-- C-2: no máximo UMA cobrança ativa por contrato. Antes o guard era um findFirst
-- não-atômico → dois POSTs concorrentes criavam 2 cobranças reais no mesmo
-- comprador. O índice faz o INSERT da segunda falhar com 23505 (Prisma P2002).
-- Pré-requisito: NÃO pode haver duplicata ativa pré-existente (senão o CREATE
-- falha). Query de detecção antes do deploy:
--   SELECT "contractId", count(*) FROM "CommissionCharge"
--   WHERE "contractId" IS NOT NULL AND "cancelledAt" IS NULL
--     AND "status" NOT IN ('REFUNDED','CANCELLED','CHARGEBACK')
--   GROUP BY "contractId" HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "commission_charge_active_contract_key"
  ON "CommissionCharge" ("contractId")
  WHERE "contractId" IS NOT NULL
    AND "cancelledAt" IS NULL
    AND "status" NOT IN ('REFUNDED', 'CANCELLED', 'CHARGEBACK');

-- W-2: o @@unique([commissionChargeId, splitRecipientId]) não protege splits
-- externos one-shot cujo splitRecipientId é NULL (no Postgres NULLs são
-- distintos num UNIQUE) → webhook replay reenviava PIX. Este índice parcial
-- dedupa por (cobrança, chave PIX) quando o recipient é nulo.
CREATE UNIQUE INDEX IF NOT EXISTS "asaas_transfer_charge_pix_null_recipient_key"
  ON "AsaasTransfer" ("commissionChargeId", "pixAddressKey")
  WHERE "splitRecipientId" IS NULL
    AND "commissionChargeId" IS NOT NULL
    AND "pixAddressKey" IS NOT NULL
    AND "origin" = 'split_dispatch';
