-- CreateTable
CREATE TABLE "AsaasTransfer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "asaasTransferId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "netValue" DOUBLE PRECISION,
    "transferFee" DOUBLE PRECISION,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pixAddressKey" TEXT,
    "pixKeyType" TEXT,
    "ownerName" TEXT,
    "ownerCpfCnpj" TEXT,
    "bankAccountJson" JSONB,
    "requestedBy" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "description" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "financialTransactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "asaasPaymentId" TEXT,
    "matchedChargeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsaasTransfer_asaasTransferId_key" ON "AsaasTransfer"("asaasTransferId");

-- CreateIndex
CREATE INDEX "AsaasTransfer_orgId_status_idx" ON "AsaasTransfer"("orgId", "status");

-- CreateIndex
CREATE INDEX "AsaasTransfer_orgId_createdAt_idx" ON "AsaasTransfer"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BankReconciliation_orgId_status_idx" ON "BankReconciliation"("orgId", "status");

-- CreateIndex
CREATE INDEX "BankReconciliation_orgId_date_idx" ON "BankReconciliation"("orgId", "date");

-- CreateIndex
CREATE INDEX "BankReconciliation_matchedChargeId_idx" ON "BankReconciliation"("matchedChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_orgId_financialTransactionId_key" ON "BankReconciliation"("orgId", "financialTransactionId");

-- AddForeignKey
ALTER TABLE "AsaasTransfer" ADD CONSTRAINT "AsaasTransfer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasTransfer" ADD CONSTRAINT "AsaasTransfer_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_matchedBy_fkey" FOREIGN KEY ("matchedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
