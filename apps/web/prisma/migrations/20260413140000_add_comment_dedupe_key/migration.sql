-- AlterTable
ALTER TABLE "ContractComment" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContractComment_contractId_dedupeKey_key" ON "ContractComment"("contractId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ContractComment_contractId_authorType_resolved_idx" ON "ContractComment"("contractId", "authorType", "resolved");
