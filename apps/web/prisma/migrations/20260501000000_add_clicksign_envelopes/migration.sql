-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clicksignId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authMethod" TEXT NOT NULL DEFAULT 'email',
    "documentClicksignId" TEXT,
    "documentUrl" TEXT,
    "signedDocumentUrl" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "deadlineAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeSigner" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "clicksignId" TEXT,
    "requirementIds" TEXT[],
    "sourceKind" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "documentation" TEXT,
    "phone" TEXT,
    "authMethod" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notifiedAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvelopeSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeEvent" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_clicksignId_key" ON "Envelope"("clicksignId");
CREATE INDEX "Envelope_contractId_idx" ON "Envelope"("contractId");
CREATE INDEX "Envelope_dealId_idx" ON "Envelope"("dealId");
CREATE INDEX "Envelope_orgId_status_idx" ON "Envelope"("orgId", "status");
CREATE INDEX "Envelope_status_updatedAt_idx" ON "Envelope"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "EnvelopeSigner_envelopeId_idx" ON "EnvelopeSigner"("envelopeId");
CREATE INDEX "EnvelopeSigner_status_idx" ON "EnvelopeSigner"("status");

-- CreateIndex
CREATE INDEX "EnvelopeEvent_envelopeId_receivedAt_idx" ON "EnvelopeEvent"("envelopeId", "receivedAt");

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EnvelopeEvent" ADD CONSTRAINT "EnvelopeEvent_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
