-- J.2 (Phase J, 2026-04-18) — retry automático + navegação para campo faltante.
-- nextRetryAt: timestamp até quando o cron espera antes de re-tentar
-- maxRetries: teto por job (default 3, pode ser sobrescrito por endpoint)
-- missingFields: lista de campos que faltam quando status=data_missing
-- portalUrl: URL oficial do portal como último recurso (cópia do catálogo)

ALTER TABLE "CertidaoJob" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "CertidaoJob" ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "CertidaoJob" ADD COLUMN "missingFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CertidaoJob" ADD COLUMN "portalUrl" TEXT;

-- Index útil para o cron que busca jobs aguardando retry.
CREATE INDEX "CertidaoJob_status_nextRetryAt_idx"
  ON "CertidaoJob"("status", "nextRetryAt")
  WHERE "nextRetryAt" IS NOT NULL;
