-- Workstream B — run de revisão pós-geração de contrato.
--
-- O hook da geração não pode chamar o LLM (waitUntil é fire-and-forget e a
-- revisão com escada não cabe ali): ele ENFILEIRA um run e dispara a rota
-- /api/contracts/review-runs/:id/advance; o cron
-- /api/cron/contract-review/sweep varre o que ficou parado. Mesmo trio do
-- IngestionRun — status + startedAt (claim atômico no WHERE) + report Json —
-- sem fatias: um contrato é uma unidade.
--
-- Índices: (orgId, status) para listagem/gasto por org; (status, updatedAt) é
-- exatamente a query do sweeper; (contractId) para a tela do contrato achar a
-- revisão da versão.
CREATE TABLE "ContractReviewRun" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "aiCostUsd" DECIMAL(12,6),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractReviewRun_orgId_status_idx" ON "ContractReviewRun"("orgId", "status");
CREATE INDEX "ContractReviewRun_status_updatedAt_idx" ON "ContractReviewRun"("status", "updatedAt");
CREATE INDEX "ContractReviewRun_contractId_idx" ON "ContractReviewRun"("contractId");

ALTER TABLE "ContractReviewRun" ADD CONSTRAINT "ContractReviewRun_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
