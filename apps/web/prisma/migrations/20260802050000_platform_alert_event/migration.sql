-- Motor de alerta da plataforma (fase 2 do plano do console).
-- Dedupe por (kind, signature): ocorrência repetida incrementa count em vez
-- de criar linha. Sem FK pra Organization de propósito — o alerta "org X
-- quebrou e foi apagada" não pode sumir junto com a org.
-- Idempotente (IF NOT EXISTS): re-execução em deploy não quebra.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlatformAlertEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "orgId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "title" TEXT NOT NULL,
    "payload" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAlertEvent_kind_signature_key" ON "PlatformAlertEvent"("kind", "signature");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformAlertEvent_lastSeenAt_idx" ON "PlatformAlertEvent"("lastSeenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformAlertEvent_notifiedAt_idx" ON "PlatformAlertEvent"("notifiedAt");
