-- ChatMessage.events: array de eventos AgentEvent do streamContractAgent.
-- Idempotente (IF NOT EXISTS) porque single-tenant prod sem homolog dispara
-- "migrate deploy" direto; rerun deve ser no-op.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "events" JSONB;
