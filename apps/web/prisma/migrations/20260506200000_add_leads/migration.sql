-- Lead — pré-Deal pra Newton acumular contexto antes de virar negocio formal.
-- Multi-phone via Postgres array + GIN index pra lookup_by_phone rápido.

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "convertedDealId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_convertedDealId_key" ON "Lead"("convertedDealId");
CREATE INDEX "Lead_orgId_status_idx" ON "Lead"("orgId", "status");
CREATE INDEX "Lead_orgId_lastActivityAt_idx" ON "Lead"("orgId", "lastActivityAt");
CREATE INDEX "Lead_phones_idx" ON "Lead" USING GIN ("phones");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedDealId_fkey"
    FOREIGN KEY ("convertedDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- LeadAttachment — docs colados na lead. SHA-256 pra dedupe.
CREATE TABLE "LeadAttachment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadAttachment_leadId_idx" ON "LeadAttachment"("leadId");
CREATE INDEX "LeadAttachment_contentHash_idx" ON "LeadAttachment"("contentHash");

ALTER TABLE "LeadAttachment" ADD CONSTRAINT "LeadAttachment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
