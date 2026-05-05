-- ActionIntent — human-in-the-loop para ações high-risk via Bearer.
-- Diferente de DualApproval (segregação de funções), aqui o dono do token
-- tipicamente também aprova suas próprias intents.

CREATE TABLE "ActionIntent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "actorVia" TEXT NOT NULL,
    "tokenId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActionIntent_requestedBy_idempotencyKey_key"
    ON "ActionIntent"("requestedBy", "idempotencyKey");

CREATE INDEX "ActionIntent_orgId_status_expiresAt_idx"
    ON "ActionIntent"("orgId", "status", "expiresAt");

CREATE INDEX "ActionIntent_requestedBy_createdAt_idx"
    ON "ActionIntent"("requestedBy", "createdAt");

ALTER TABLE "ActionIntent" ADD CONSTRAINT "ActionIntent_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionIntent" ADD CONSTRAINT "ActionIntent_requestedBy_fkey"
    FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ActionIntent" ADD CONSTRAINT "ActionIntent_approvedBy_fkey"
    FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ActionIntent" ADD CONSTRAINT "ActionIntent_tokenId_fkey"
    FOREIGN KEY ("tokenId") REFERENCES "UserApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
