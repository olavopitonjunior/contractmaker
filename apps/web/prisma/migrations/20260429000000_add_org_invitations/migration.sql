-- Convite com fila de aprovação. Owner cria invitation; approver
-- aprova; sistema cria User+OrgMembership e dispara magic link.
-- Nenhum User é criado antes da aprovação.

CREATE TABLE "OrgInvitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgInvitation_orgId_status_idx" ON "OrgInvitation"("orgId", "status");
CREATE INDEX "OrgInvitation_email_idx" ON "OrgInvitation"("email");
CREATE INDEX "OrgInvitation_status_createdAt_idx" ON "OrgInvitation"("status", "createdAt");

ALTER TABLE "OrgInvitation"
    ADD CONSTRAINT "OrgInvitation_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrgInvitation"
    ADD CONSTRAINT "OrgInvitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrgInvitation"
    ADD CONSTRAINT "OrgInvitation_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
