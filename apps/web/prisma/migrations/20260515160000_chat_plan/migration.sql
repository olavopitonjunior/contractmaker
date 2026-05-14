-- ChatPlan: plano proposto pelo agente em modo Plan-and-approve. Reads do
-- plano sao auto-executados pelo handler de `propose_plan`; writes esperam
-- POST /api/contracts/[id]/chat/execute-plan com a lista de stepIds aprovados.

CREATE TABLE IF NOT EXISTS "ChatPlan" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "stepsJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatPlan_messageId_key" ON "ChatPlan"("messageId");
CREATE INDEX IF NOT EXISTS "ChatPlan_sessionId_idx" ON "ChatPlan"("sessionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatPlan_sessionId_fkey'
  ) THEN
    ALTER TABLE "ChatPlan"
      ADD CONSTRAINT "ChatPlan_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
