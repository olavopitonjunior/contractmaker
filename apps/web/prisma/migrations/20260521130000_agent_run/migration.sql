-- D (QA deal 20486): tabela de log/observabilidade dos turns do chat multi-agente.
-- Sem FK de propósito — o registro sobrevive à exclusão de contrato/sessão.
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT,
    "sessionId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,
    "mode" TEXT NOT NULL,
    "intent" TEXT,
    "agentsRun" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "toolCallsJson" JSONB,
    "writesAttempted" INTEGER NOT NULL DEFAULT 0,
    "writesApplied" INTEGER NOT NULL DEFAULT 0,
    "writesPending" INTEGER NOT NULL DEFAULT 0,
    "writesFailed" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "finalMessagePreview" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_orgId_createdAt_idx" ON "AgentRun"("orgId", "createdAt");
CREATE INDEX "AgentRun_orgId_outcome_createdAt_idx" ON "AgentRun"("orgId", "outcome", "createdAt");
CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");
CREATE INDEX "AgentRun_contractId_createdAt_idx" ON "AgentRun"("contractId", "createdAt");
