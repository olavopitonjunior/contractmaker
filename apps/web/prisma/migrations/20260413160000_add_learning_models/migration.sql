-- CreateTable ContractMemory
CREATE TABLE "ContractMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT,
    "templateId" TEXT,
    "dataFingerprint" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "acceptedSuggestions" JSONB NOT NULL,
    "rejectedSuggestions" JSONB NOT NULL,
    "manualEdits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractMemory_pkey" PRIMARY KEY ("id")
);

-- Add vector column for semantic similarity search
ALTER TABLE "ContractMemory" ADD COLUMN "embedding" vector(1024);

-- Indexes
CREATE INDEX "ContractMemory_orgId_templateId_idx" ON "ContractMemory"("orgId", "templateId");
CREATE INDEX "ContractMemory_embedding_idx" ON "ContractMemory" USING hnsw (embedding vector_cosine_ops);

-- FK
ALTER TABLE "ContractMemory" ADD CONSTRAINT "ContractMemory_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ClauseProposal
CREATE TABLE "ClauseProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "groupCode" TEXT,
    "category" TEXT,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClauseProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClauseProposal_orgId_status_idx" ON "ClauseProposal"("orgId", "status");

ALTER TABLE "ClauseProposal" ADD CONSTRAINT "ClauseProposal_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable TemplateSuggestion
CREATE TABLE "TemplateSuggestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "diffHunks" JSONB NOT NULL,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TemplateSuggestion_templateId_status_idx" ON "TemplateSuggestion"("templateId", "status");
CREATE INDEX "TemplateSuggestion_orgId_status_idx" ON "TemplateSuggestion"("orgId", "status");

ALTER TABLE "TemplateSuggestion" ADD CONSTRAINT "TemplateSuggestion_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemplateSuggestion" ADD CONSTRAINT "TemplateSuggestion_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
