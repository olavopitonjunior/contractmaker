-- Add userId (audit trail) to CertidaoJob
ALTER TABLE "CertidaoJob" ADD COLUMN "userId" TEXT;

-- FK with SET NULL on user deletion (jobs survive, just lose attribution)
ALTER TABLE "CertidaoJob"
  ADD CONSTRAINT "CertidaoJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for dashboard aggregation by user/time
CREATE INDEX "CertidaoJob_userId_createdAt_idx" ON "CertidaoJob"("userId", "createdAt");
