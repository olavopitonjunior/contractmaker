-- CreateTable
CREATE TABLE "AsaasAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "asaasId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "accountNumber" TEXT,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiKeyIvBase64" TEXT NOT NULL,
    "apiKeyTagBase64" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "kyc" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "generalStatus" TEXT,
    "documentationStatus" TEXT,
    "commercialInfoStatus" TEXT,
    "bankAccountInfoStatus" TEXT,
    "lastStatusCheckAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasAccountDocument" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asaasDocumentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "rejectionReason" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "fileMime" TEXT,
    "fileSizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasAccountDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasCustomer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "asaasId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "mobilePhone" TEXT,
    "addressJson" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "sourceDealId" TEXT,
    "externalReference" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionCharge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT,
    "contractId" TEXT,
    "asaasCustomerId" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "asaasInstallmentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'commission',
    "billingType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "netValue" DOUBLE PRECISION,
    "originalDueDate" TIMESTAMP(3) NOT NULL,
    "currentDueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "asaasStatus" TEXT NOT NULL,
    "description" TEXT,
    "invoiceUrl" TEXT,
    "bankSlipUrl" TEXT,
    "identificationField" TEXT,
    "pixQrCodePayload" TEXT,
    "pixQrCodeImage" TEXT,
    "splitJson" JSONB,
    "payerSnapshot" JSONB,
    "beneficiarySnapshot" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasWebhookEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "asaasEventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "asaasPaymentId" TEXT,
    "chargeId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "AsaasWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgFinancialSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platformFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformFeeWalletId" TEXT,
    "overpricePolicy" TEXT NOT NULL DEFAULT 'none',
    "overpriceType" TEXT,
    "overpriceValue" DOUBLE PRECISION,
    "overpriceRoundTo" TEXT DEFAULT 'cents',
    "discountPresets" JSONB NOT NULL DEFAULT '[]',
    "finePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "finePolicy" TEXT NOT NULL DEFAULT 'percentage',
    "interestPercentMonth" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "asaasFeePixCents" INTEGER NOT NULL DEFAULT 199,
    "asaasFeeBoletoCents" INTEGER NOT NULL DEFAULT 349,
    "asaasFeeCardPercent" DOUBLE PRECISION NOT NULL DEFAULT 2.99,
    "asaasFeeCardCents" INTEGER NOT NULL DEFAULT 49,
    "dualApprovalCapCents" INTEGER NOT NULL DEFAULT 5000000,
    "hardCapCents" INTEGER NOT NULL DEFAULT 10000000,
    "brandLogoUrl" TEXT,
    "brandPrimaryColor" TEXT DEFAULT '#0f172a',
    "brandDisplayName" TEXT,
    "brandSupportEmail" TEXT,
    "brandSupportPhone" TEXT,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifySms" BOOLEAN NOT NULL DEFAULT false,
    "defaultDueDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgFinancialSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargePublicLink" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "brandSnapshot" JSONB NOT NULL,
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargePublicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_orgId_key" ON "AsaasAccount"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_asaasId_key" ON "AsaasAccount"("asaasId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_walletId_key" ON "AsaasAccount"("walletId");

-- CreateIndex
CREATE INDEX "AsaasAccountDocument_accountId_status_idx" ON "AsaasAccountDocument"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccountDocument_accountId_type_key" ON "AsaasAccountDocument"("accountId", "type");

-- CreateIndex
CREATE INDEX "AsaasCustomer_orgId_name_idx" ON "AsaasCustomer"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasCustomer_orgId_asaasId_key" ON "AsaasCustomer"("orgId", "asaasId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasCustomer_orgId_cpfCnpj_key" ON "AsaasCustomer"("orgId", "cpfCnpj");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionCharge_asaasPaymentId_key" ON "CommissionCharge"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "CommissionCharge_orgId_status_idx" ON "CommissionCharge"("orgId", "status");

-- CreateIndex
CREATE INDEX "CommissionCharge_orgId_currentDueDate_idx" ON "CommissionCharge"("orgId", "currentDueDate");

-- CreateIndex
CREATE INDEX "CommissionCharge_dealId_idx" ON "CommissionCharge"("dealId");

-- CreateIndex
CREATE INDEX "CommissionCharge_contractId_idx" ON "CommissionCharge"("contractId");

-- CreateIndex
CREATE INDEX "CommissionCharge_asaasCustomerId_idx" ON "CommissionCharge"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasWebhookEvent_asaasEventId_key" ON "AsaasWebhookEvent"("asaasEventId");

-- CreateIndex
CREATE INDEX "AsaasWebhookEvent_orgId_event_idx" ON "AsaasWebhookEvent"("orgId", "event");

-- CreateIndex
CREATE INDEX "AsaasWebhookEvent_asaasPaymentId_idx" ON "AsaasWebhookEvent"("asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgFinancialSettings_orgId_key" ON "OrgFinancialSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargePublicLink_chargeId_key" ON "ChargePublicLink"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargePublicLink_publicToken_key" ON "ChargePublicLink"("publicToken");

-- AddForeignKey
ALTER TABLE "AsaasAccount" ADD CONSTRAINT "AsaasAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasAccountDocument" ADD CONSTRAINT "AsaasAccountDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AsaasAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasCustomer" ADD CONSTRAINT "AsaasCustomer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_asaasCustomerId_fkey" FOREIGN KEY ("asaasCustomerId") REFERENCES "AsaasCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasWebhookEvent" ADD CONSTRAINT "AsaasWebhookEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasWebhookEvent" ADD CONSTRAINT "AsaasWebhookEvent_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "CommissionCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgFinancialSettings" ADD CONSTRAINT "OrgFinancialSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
