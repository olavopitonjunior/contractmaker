-- I.5 (Phase I, 2026-04-18) — dedupe atômico de notificações de batch
-- Antes: check em metadata JSONB sofria race condition; 5× mesma notif
-- Agora: coluna dedicada + unique index parcial.

ALTER TABLE "Notification" ADD COLUMN "batchId" TEXT;

-- Backfill a partir do metadata existente (best-effort).
UPDATE "Notification"
SET "batchId" = metadata->>'batchId'
WHERE metadata ? 'batchId';

-- Unique constraint: múltiplos NULL permitidos (PostgreSQL default), mas
-- não pode haver dois registros com o mesmo (type, batchId) não-null.
-- Purge duplicatas existentes antes de criar o índice (mantém o mais antigo
-- de cada grupo).
DELETE FROM "Notification" a
USING "Notification" b
WHERE a.id > b.id
  AND a.type = b.type
  AND a."batchId" IS NOT NULL
  AND a."batchId" = b."batchId";

CREATE UNIQUE INDEX "Notification_type_batchId_key" ON "Notification"("type", "batchId");
