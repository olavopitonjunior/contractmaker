-- Defaults de plataforma pros especialistas do orquestrador (singleton,
-- editável pelo super_admin). Campos null = fallback hardcoded.
CREATE TABLE IF NOT EXISTS "PlatformAgentDefaults" (
    "id" TEXT NOT NULL,
    "singletonKey" TEXT NOT NULL DEFAULT 'singleton',
    "analystPrompt" TEXT,
    "legalPrompt" TEXT,
    "editorPrompt" TEXT,
    "curatorPrompt" TEXT,
    "analystModel" TEXT,
    "legalModel" TEXT,
    "editorModel" TEXT,
    "curatorModel" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAgentDefaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAgentDefaults_singletonKey_key"
  ON "PlatformAgentDefaults"("singletonKey");
