-- SalesFormParticipant: subtoken por parte (vendedor/comprador) compartilhando
-- o mesmo SalesForm. Cada participant tem JWT-HMAC com AUTH_SECRET (7d).
-- Server filtra dataJson na leitura e enforça allowlist no PATCH via
-- `deepMergeAtPaths` com ROLE_PATHS[role].
--
-- FormAttachment.participantId: nullable, null = upload pelo admin.
-- Permite filtrar attachments por parte na step 0 do form público.
--
-- Idempotente — single-tenant prod sem homolog roda "migrate deploy" direto.

CREATE TABLE IF NOT EXISTS "SalesFormParticipant" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "partyIndex" INTEGER NOT NULL DEFAULT 0,
    "token" TEXT NOT NULL,
    "tokenExp" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesFormParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalesFormParticipant_token_key" ON "SalesFormParticipant"("token");

CREATE INDEX IF NOT EXISTS "SalesFormParticipant_formId_role_idx" ON "SalesFormParticipant"("formId", "role");

ALTER TABLE "SalesFormParticipant"
    DROP CONSTRAINT IF EXISTS "SalesFormParticipant_formId_fkey";

ALTER TABLE "SalesFormParticipant"
    ADD CONSTRAINT "SalesFormParticipant_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "SalesForm"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FormAttachment.participantId

ALTER TABLE "FormAttachment" ADD COLUMN IF NOT EXISTS "participantId" TEXT;

CREATE INDEX IF NOT EXISTS "FormAttachment_formId_participantId_idx" ON "FormAttachment"("formId", "participantId");

ALTER TABLE "FormAttachment"
    DROP CONSTRAINT IF EXISTS "FormAttachment_participantId_fkey";

ALTER TABLE "FormAttachment"
    ADD CONSTRAINT "FormAttachment_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "SalesFormParticipant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
