-- AI Insights config (F3.7) — toggle per-tipo + observabilidade.
-- Persiste em AgentConfig (1:1 com Organization). Aditivo. Idempotente.

ALTER TABLE "AgentConfig"
  ADD COLUMN IF NOT EXISTS "aiInsightsConfig" JSONB;
