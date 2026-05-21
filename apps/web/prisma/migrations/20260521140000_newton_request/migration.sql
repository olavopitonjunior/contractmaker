-- NewtonRequest — fila de "pedidos ao Newton" ancorada num Deal.
-- A negociadora registra, de dentro do negócio, uma informação que falta e para
-- quem cobrar; Newton vai ao grupo/contato, cobra, agenda lembretes e fecha.
CREATE TABLE "NewtonRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "ask" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetRef" TEXT,
    "targetLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueAt" TIMESTAMP(3),
    "cronJobIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastNudgeAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "eventsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewtonRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewtonRequest_orgId_status_createdAt_idx" ON "NewtonRequest"("orgId", "status", "createdAt");
CREATE INDEX "NewtonRequest_dealId_status_idx" ON "NewtonRequest"("dealId", "status");

ALTER TABLE "NewtonRequest" ADD CONSTRAINT "NewtonRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewtonRequest" ADD CONSTRAINT "NewtonRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewtonRequest" ADD CONSTRAINT "NewtonRequest_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DealGroupLink — vínculo persistido deal ↔ grupo de WhatsApp (um grupo = um deal).
CREATE TABLE "DealGroupLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupLabel" TEXT,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DealGroupLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealGroupLink_dealId_key" ON "DealGroupLink"("dealId");
CREATE INDEX "DealGroupLink_orgId_groupId_idx" ON "DealGroupLink"("orgId", "groupId");

ALTER TABLE "DealGroupLink" ADD CONSTRAINT "DealGroupLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealGroupLink" ADD CONSTRAINT "DealGroupLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
