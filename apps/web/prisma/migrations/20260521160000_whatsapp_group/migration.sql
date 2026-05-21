-- WhatsappGroup / WhatsappGroupMember — registro dos grupos de WhatsApp observados
-- (sincronizado do sidecar). Base do auto-link deal↔grupo e dos candidatos na UI.
CREATE TABLE "WhatsappGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappGroup_orgId_groupId_key" ON "WhatsappGroup"("orgId", "groupId");

CREATE TABLE "WhatsappGroupMember" (
    "id" TEXT NOT NULL,
    "groupRowId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappGroupMember_groupRowId_phone_key" ON "WhatsappGroupMember"("groupRowId", "phone");
CREATE INDEX "WhatsappGroupMember_phone_idx" ON "WhatsappGroupMember"("phone");

ALTER TABLE "WhatsappGroup" ADD CONSTRAINT "WhatsappGroup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappGroupMember" ADD CONSTRAINT "WhatsappGroupMember_groupRowId_fkey" FOREIGN KEY ("groupRowId") REFERENCES "WhatsappGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
