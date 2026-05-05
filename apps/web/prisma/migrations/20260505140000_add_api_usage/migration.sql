-- ApiUsage — telemetry granular de chamadas Newton API.
-- Capturado por withApi wrapper. TTL 90 dias (cleanup cron diário).

CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT,
    "via" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiUsage_orgId_createdAt_idx" ON "ApiUsage"("orgId", "createdAt");
CREATE INDEX "ApiUsage_tokenId_createdAt_idx" ON "ApiUsage"("tokenId", "createdAt");
CREATE INDEX "ApiUsage_path_createdAt_idx" ON "ApiUsage"("path", "createdAt");
