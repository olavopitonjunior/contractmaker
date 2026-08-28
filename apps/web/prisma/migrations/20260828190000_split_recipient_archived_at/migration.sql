-- SplitRecipient.archivedAt — separa "excluído" de "rascunho".
--
-- `active` acumulava dois sentidos incompatíveis:
--   1. rascunho sem meio de repasse (createCommissioner põe pendingFields e
--      active:false — o splitDispatcher precisa disso);
--   2. excluído pelo admin (o DELETE fazia soft delete com active:false).
--
-- O picker do formulário público filtrava `active = true` e engolia os dois
-- juntos: na org de produção, 42 comissionados cadastrados e 2 oferecidos.
-- Só 5 tinham sido de fato excluídos (AuditLog SPLIT_RECIPIENT_DELETED).
--
-- Idempotente: pode rodar de novo sem efeito.

ALTER TABLE "SplitRecipient" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Backfill 1 — exclusões de verdade, pelo rastro de auditoria.
-- O AuditLog é a única fonte que distingue "o admin apagou" de "nasceu
-- rascunho"; a coluna `active` sozinha não distingue, que é o bug.
UPDATE "SplitRecipient" sr
   SET "archivedAt" = a."at"
  FROM (
        SELECT split_part("resource", ':', 2) AS id, MAX("createdAt") AS "at"
          FROM "AuditLog"
         WHERE "action" = 'SPLIT_RECIPIENT_DELETED'
           AND "result" = 'SUCCESS'
           AND "resource" LIKE 'split_recipient:%'
         GROUP BY 1
       ) a
 WHERE sr."id" = a."id"
   AND sr."archivedAt" IS NULL
   AND sr."active" = false;

-- Backfill 2 — duplicatas que a migration 20260724120000 desativou.
-- Elas têm dados completos (pendingFields vazio) e estão inativas: não são
-- rascunho, e ressuscitá-las no picker devolveria justamente as duplicatas que
-- aquela migration resolveu.
UPDATE "SplitRecipient"
   SET "archivedAt" = COALESCE("updatedAt", NOW())
 WHERE "archivedAt" IS NULL
   AND "active" = false
   AND cardinality("pendingFields") = 0;

CREATE INDEX IF NOT EXISTS "SplitRecipient_orgId_kind_archivedAt_idx"
    ON "SplitRecipient" ("orgId", "kind", "archivedAt");
