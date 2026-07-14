-- ClickSign multitenant — conta própria da imobiliária (credenciais + webhook)
-- e preferências de assinatura por org. Idempotente: IF NOT EXISTS pra
-- sobreviver a re-run em prod/staging.

-- A migration órfã 20260527140000_clicksign_account (removida do repo) criou uma
-- ClickSignAccount ANTIGA de white-label (mode/whiteLabelId/apiKeyCiphertext/
-- hmacSecret*) que ficou sem model no schema, sem referência no código e com 0
-- linhas em prod. Este design (per-org token + webhook slug) a SUBSTITUI, então
-- dropamos a tabela órfã antes de recriar no formato novo.
DROP TABLE IF EXISTS "ClickSignAccount";

-- ClickSignAccount: uma conta ClickSign por org (token/webhook criptografados).
CREATE TABLE IF NOT EXISTS "ClickSignAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT,
    "apiTokenEncrypted" TEXT NOT NULL,
    "apiTokenIvBase64" TEXT NOT NULL,
    "apiTokenTagBase64" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://app.clicksign.com',
    "webhookSlug" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT,
    "webhookSecretIvBase64" TEXT,
    "webhookSecretTagBase64" TEXT,
    "clicksignWebhookId" TEXT,
    "webhookProvisioned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "accountName" TEXT,
    "connectedById" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickSignAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClickSignAccount_orgId_key" ON "ClickSignAccount"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClickSignAccount_webhookSlug_key" ON "ClickSignAccount"("webhookSlug");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ClickSignAccount_orgId_fkey'
    ) THEN
        ALTER TABLE "ClickSignAccount"
            ADD CONSTRAINT "ClickSignAccount_orgId_fkey"
            FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- OrgSignatureSettings: preferências de assinatura por org (existe mesmo sem
-- conta própria — a org legada usa o token global mas tem seus padrões).
CREATE TABLE IF NOT EXISTS "OrgSignatureSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "monthlyBudgetCents" INTEGER,
    "costOverridesJson" JSONB,
    "defaultAuthMethod" TEXT NOT NULL DEFAULT 'email',
    "allowedAuthMethods" TEXT[] NOT NULL DEFAULT ARRAY['email', 'whatsapp', 'selfie', 'icp_brasil']::TEXT[],
    "defaultLocale" TEXT NOT NULL DEFAULT 'pt-BR',
    "autoClose" BOOLEAN NOT NULL DEFAULT true,
    "refusable" BOOLEAN NOT NULL DEFAULT true,
    "defaultDeadlineDays" INTEGER,
    "defaultSequential" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSignatureSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgSignatureSettings_orgId_key" ON "OrgSignatureSettings"("orgId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'OrgSignatureSettings_orgId_fkey'
    ) THEN
        ALTER TABLE "OrgSignatureSettings"
            ADD CONSTRAINT "OrgSignatureSettings_orgId_fkey"
            FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
