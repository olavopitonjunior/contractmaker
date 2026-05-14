-- ContractChangeLog: snapshots htmlBefore/htmlAfter + sessionId pra que o
-- ChangesPanel da UI possa renderizar diff visual por turn e filtrar
-- mudanças por session de chat. Idempotente.

ALTER TABLE "ContractChangeLog"
  ADD COLUMN IF NOT EXISTS "htmlBefore" TEXT;

ALTER TABLE "ContractChangeLog"
  ADD COLUMN IF NOT EXISTS "htmlAfter" TEXT;

ALTER TABLE "ContractChangeLog"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

-- Index pra listagem rápida no ChangesPanel — vamos sempre filtrar por
-- contractId + ordenar por createdAt desc.
CREATE INDEX IF NOT EXISTS "ContractChangeLog_contractId_createdAt_idx"
  ON "ContractChangeLog"("contractId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ContractChangeLog_sessionId_idx"
  ON "ContractChangeLog"("sessionId");
