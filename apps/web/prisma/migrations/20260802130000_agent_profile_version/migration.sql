-- Histórico do AgentProfile (fase 3 do plano do console): um snapshot por
-- escrita, buscado por (orgId, agentKey). Sem FK pro AgentProfile de
-- propósito — a linha de perfil pode ser recriada e o histórico não pode
-- morrer junto. Idempotente (IF NOT EXISTS).

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentProfileVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "agentKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProfileVersion_orgId_agentKey_createdAt_idx" ON "AgentProfileVersion"("orgId", "agentKey", "createdAt");
