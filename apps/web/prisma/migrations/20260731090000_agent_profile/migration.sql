-- AgentProfile — plano de controle único dos agentes de IA.
--
-- Antes desta migration a configuração vivia em três tabelas que não se
-- falavam: AgentConfig (1 por org, alimenta o agente legado + OCR + insights),
-- PlatformAgentDefaults (singleton, 4 especialistas do orquestrador) e
-- SupportAgentConfig (singleton, IA de suporte). Nenhuma delas permitia
-- override por org E por agente ao mesmo tempo — que é exatamente o que o
-- console de agentes precisa.
--
-- `orgId IS NULL` = default da plataforma. Resolução em cadeia no código:
-- linha da org → linha da plataforma → hardcoded.
--
-- Idempotente de ponta a ponta (migrate deploy roda a cada build):
--  * CREATE ... IF NOT EXISTS em tabela e índices;
--  * os INSERTs de migração de dados usam ON CONFLICT DO NOTHING sobre as
--    chaves únicas, então rodar de novo não duplica nem sobrescreve edição
--    feita depois pelo admin.
--
-- As 3 tabelas de origem NÃO são dropadas aqui: ficam como janela de rollback
-- por uma release (mesmo padrão usado em Clause → KnowledgeItem). Um PR de
-- follow-up remove.

CREATE TABLE IF NOT EXISTS "AgentProfile" (
  "id"               TEXT NOT NULL,
  "orgId"            TEXT,
  "agentKey"         TEXT NOT NULL,
  "enabled"          BOOLEAN NOT NULL DEFAULT true,
  "model"            TEXT,
  "fallbackModel"    TEXT,
  "temperature"      DOUBLE PRECISION,
  "maxTokens"        INTEGER,
  "instructions"     TEXT,
  "ragScope"         JSONB,
  "monthlyBudgetUsd" DECIMAL(12,2),
  "config"           JSONB,
  "updatedBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AgentProfile"
    ADD CONSTRAINT "AgentProfile_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unicidade do override por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProfile_orgId_agentKey_key"
  ON "AgentProfile"("orgId", "agentKey");

-- ⚠️ O índice acima NÃO cobre as linhas de plataforma: no Postgres dois NULLs
-- são distintos, então ("orgId"=NULL,'editor') poderia existir N vezes e a
-- resolução (findFirst) escolheria uma delas ao acaso. Daí o índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProfile_platform_agentKey_key"
  ON "AgentProfile"("agentKey") WHERE "orgId" IS NULL;

CREATE INDEX IF NOT EXISTS "AgentProfile_agentKey_idx"
  ON "AgentProfile"("agentKey");

-- ────────────────────────────────────────────────────────────────────────────
-- Migração de dados 1/3 — PlatformAgentDefaults (singleton) → 4 linhas de
-- plataforma. Campo null na origem continua null aqui: null = "herda o
-- hardcoded", que é a mesma semântica de antes.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "model", "instructions", "updatedBy", "createdAt", "updatedAt")
SELECT
  'agp_plat_' || k.agent_key,
  NULL,
  k.agent_key,
  k.model,
  k.prompt,
  p."updatedBy",
  COALESCE(p."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "PlatformAgentDefaults" p
CROSS JOIN LATERAL (
  VALUES
    ('analyst', p."analystModel", p."analystPrompt"),
    ('legal',   p."legalModel",   p."legalPrompt"),
    ('editor',  p."editorModel",  p."editorPrompt"),
    ('curator', p."curatorModel", p."curatorPrompt")
) AS k(agent_key, model, prompt)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Migração de dados 2/3 — SupportAgentConfig (singleton) → linha de plataforma
-- do agente `support`. handoffMinSimilarity não merece coluna própria (só o
-- suporte usa) e vai pro `config`. systemPrompt vazio significava "usa o
-- default em código" → vira NULL, que é como o novo modelo diz "herda".
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "model", "temperature", "maxTokens", "instructions", "config", "updatedBy", "createdAt", "updatedAt")
SELECT
  'agp_plat_support',
  NULL,
  'support',
  s."model",
  s."temperature",
  s."maxTokens",
  NULLIF(TRIM(s."systemPrompt"), ''),
  jsonb_build_object('handoffMinSimilarity', s."handoffMinSimilarity"),
  s."updatedBy",
  COALESCE(s."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "SupportAgentConfig" s
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Migração de dados 3/3 — AgentConfig (1 por org) → até 3 linhas por org:
--   chat_legacy: model/temperature/maxTokens/systemPrompt do agente legado.
--                O systemPrompt do tenant também alimenta os especialistas via
--                getTenantAgentInstructions, então precisa sobreviver.
--   ocr:         ocrModel.
--   insights:    aiInsightsConfig.
-- Linhas só são criadas quando há algo a preservar — org que nunca customizou
-- não ganha linha e segue no default da plataforma.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "model", "temperature", "maxTokens", "instructions", "createdAt", "updatedAt")
SELECT
  'agp_' || a."orgId" || '_chat_legacy',
  a."orgId",
  'chat_legacy',
  a."model",
  a."temperature",
  a."maxTokens",
  NULLIF(TRIM(a."systemPrompt"), ''),
  COALESCE(a."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "AgentConfig" a
ON CONFLICT DO NOTHING;

INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "model", "createdAt", "updatedAt")
SELECT
  'agp_' || a."orgId" || '_ocr',
  a."orgId",
  'ocr',
  a."ocrModel",
  COALESCE(a."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "AgentConfig" a
WHERE a."ocrModel" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "config", "createdAt", "updatedAt")
SELECT
  'agp_' || a."orgId" || '_insights',
  a."orgId",
  'insights',
  a."aiInsightsConfig",
  COALESCE(a."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "AgentConfig" a
WHERE a."aiInsightsConfig" IS NOT NULL
ON CONFLICT DO NOTHING;
