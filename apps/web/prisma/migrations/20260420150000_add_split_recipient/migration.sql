-- CreateTable
CREATE TABLE "SplitRecipient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SplitRecipient_orgId_walletId_key" ON "SplitRecipient"("orgId", "walletId");

-- CreateIndex
CREATE INDEX "SplitRecipient_orgId_active_idx" ON "SplitRecipient"("orgId", "active");

-- AddForeignKey
ALTER TABLE "SplitRecipient" ADD CONSTRAINT "SplitRecipient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
