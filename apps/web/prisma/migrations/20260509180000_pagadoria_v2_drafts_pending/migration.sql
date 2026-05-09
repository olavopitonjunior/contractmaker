-- Pagadoria v2 — rascunho SplitRecipient + magic link (2026-05-09)
-- Idempotente: ADD COLUMN IF NOT EXISTS.

-- 1. SplitRecipient.pendingFields — lista de campos pendentes (rascunho)
ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "pendingFields" TEXT[] NOT NULL DEFAULT '{}';

-- 2. SplitRecipient.completionToken — JWT pra completar cadastro via /financeiro/completar-cadastro
ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "completionToken" TEXT;

-- 3. SplitRecipient.completionTokenExp — expiração do token (default +7d quando setado)
ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "completionTokenExp" TIMESTAMP(3);
