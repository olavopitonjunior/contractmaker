-- AddForeignKey
ALTER TABLE "ChargePublicLink" ADD CONSTRAINT "ChargePublicLink_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "CommissionCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
