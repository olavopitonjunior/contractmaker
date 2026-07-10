-- Support AI: config singleton + fila de handoffs + log de interações.
-- Idempotente (auto-mode bloqueia `prisma migrate dev`; SQL plano com IF NOT EXISTS).
-- A base de conhecimento de suporte reusa a tabela KnowledgeItem existente
-- (category='support'); nenhuma coluna vector nova aqui.

-- SupportAgentConfig (singleton) -------------------------------------------------
CREATE TABLE IF NOT EXISTS "SupportAgentConfig" (
  "id"                   TEXT NOT NULL,
  "singletonKey"         TEXT NOT NULL DEFAULT 'singleton',
  "model"                TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  "temperature"          DOUBLE PRECISION NOT NULL DEFAULT 0.3,
  "maxTokens"            INTEGER NOT NULL DEFAULT 1024,
  "systemPrompt"         TEXT NOT NULL DEFAULT '',
  "handoffMinSimilarity" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
  "updatedBy"            TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAgentConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportAgentConfig_singletonKey_key"
  ON "SupportAgentConfig" ("singletonKey");

-- SupportHandoff ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SupportHandoff" (
  "id"                 TEXT NOT NULL,
  "orgId"              TEXT,
  "userId"             TEXT,
  "question"           TEXT NOT NULL,
  "normalizedQuestion" TEXT NOT NULL,
  "transcriptJson"     JSONB,
  "screenPath"         TEXT,
  "status"             TEXT NOT NULL DEFAULT 'pending',
  "answer"             TEXT,
  "answeredBy"         TEXT,
  "answeredAt"         TIMESTAMP(3),
  "knowledgeItemId"    TEXT,
  "count"              INTEGER NOT NULL DEFAULT 1,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportHandoff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportHandoff_status_createdAt_idx"
  ON "SupportHandoff" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportHandoff_normalizedQuestion_status_idx"
  ON "SupportHandoff" ("normalizedQuestion", "status");

-- SupportInteraction ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SupportInteraction" (
  "id"              TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "userId"          TEXT,
  "question"        TEXT NOT NULL,
  "answer"          TEXT,
  "screenPath"      TEXT,
  "kbTopSimilarity" DOUBLE PRECISION,
  "kbHitIds"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "handoffCreated"  BOOLEAN NOT NULL DEFAULT false,
  "handoffId"       TEXT,
  "rating"          INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportInteraction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportInteraction_orgId_createdAt_idx"
  ON "SupportInteraction" ("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportInteraction_rating_idx"
  ON "SupportInteraction" ("rating");
