-- Análise de crédito e certidões na PROPOSTA (pré-Deal) — costura de schema.
--
-- POR QUÊ. A imobiliária colhe documentos e roda análise de crédito do
-- locatário/fiador ANTES de levar a proposta ao proprietário. Hoje CertidaoJob
-- só conhece Deal e LeaseClient, ProposalAttachment não tem OCR, e não existe
-- agregado para uma "solicitação" de laudo com N pretendentes (Ficha Certa
-- Digital, conta por imobiliária). Este PR só cria as colunas/tabelas; as
-- rotas, o executor e a UI vêm nos PRs seguintes — nada aqui é lido ainda.
--
-- Aditiva e idempotente: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT
-- EXISTS, FKs sob guard em pg_constraint. Sem backfill (não há dado a mover).

-- Proposal: consentimentos LGPD (creditConsent), copiados ao Deal no convert.
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "complianceJson" JSONB;

-- ProposalAttachment: OCR on-demand + vínculo com o job de certidão/laudo.
ALTER TABLE "ProposalAttachment" ADD COLUMN IF NOT EXISTS "extractedData" JSONB;
ALTER TABLE "ProposalAttachment" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'awaiting_user';
ALTER TABLE "ProposalAttachment" ADD COLUMN IF NOT EXISTS "extractError" TEXT;
ALTER TABLE "ProposalAttachment" ADD COLUMN IF NOT EXISTS "extractingStartedAt" TIMESTAMP(3);
ALTER TABLE "ProposalAttachment" ADD COLUMN IF NOT EXISTS "certidaoJobId" TEXT;
CREATE INDEX IF NOT EXISTS "ProposalAttachment_proposalId_status_idx"
  ON "ProposalAttachment"("proposalId", "status");
CREATE INDEX IF NOT EXISTS "ProposalAttachment_certidaoJobId_idx"
  ON "ProposalAttachment"("certidaoJobId");

-- CertidaoJob: terceiro sujeito (proposta) + agregado da análise de crédito.
ALTER TABLE "CertidaoJob" ADD COLUMN IF NOT EXISTS "proposalId" TEXT;
ALTER TABLE "CertidaoJob" ADD COLUMN IF NOT EXISTS "creditRequestId" TEXT;
CREATE INDEX IF NOT EXISTS "CertidaoJob_proposalId_batchId_idx"
  ON "CertidaoJob"("proposalId", "batchId");
CREATE INDEX IF NOT EXISTS "CertidaoJob_creditRequestId_idx"
  ON "CertidaoJob"("creditRequestId");

-- Conta Ficha Certa por imobiliária (molde da ClickSignAccount).
CREATE TABLE IF NOT EXISTS "FichaCertaAccount" (
  "id"                            TEXT NOT NULL,
  "orgId"                         TEXT NOT NULL,
  "label"                         TEXT,
  "login"                         TEXT NOT NULL,
  "passwordEncrypted"             TEXT NOT NULL,
  "passwordIvBase64"              TEXT NOT NULL,
  "passwordTagBase64"             TEXT NOT NULL,
  "baseUrl"                       TEXT NOT NULL DEFAULT 'https://api.fichacertadigital.com.br',
  "webhookSlug"                   TEXT NOT NULL,
  "webhookTokenUser"              TEXT NOT NULL,
  "webhookTokenPasswordEncrypted" TEXT NOT NULL,
  "webhookTokenPasswordIvBase64"  TEXT NOT NULL,
  "webhookTokenPasswordTagBase64" TEXT NOT NULL,
  "webhookQuerySecretEncrypted"   TEXT NOT NULL,
  "webhookQuerySecretIvBase64"    TEXT NOT NULL,
  "webhookQuerySecretTagBase64"   TEXT NOT NULL,
  "fichaCertaWebhookId"           TEXT,
  "webhookProvisioned"            BOOLEAN NOT NULL DEFAULT false,
  "products"                      TEXT NOT NULL DEFAULT '1,9',
  "costCents"                     INTEGER NOT NULL DEFAULT 1500,
  "clienteId"                     TEXT,
  "status"                        TEXT NOT NULL DEFAULT 'connected',
  "connectedById"                 TEXT,
  "lastValidatedAt"               TIMESTAMP(3),
  "lastError"                     TEXT,
  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FichaCertaAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FichaCertaAccount_orgId_key" ON "FichaCertaAccount"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "FichaCertaAccount_webhookSlug_key" ON "FichaCertaAccount"("webhookSlug");

-- Agregado neutro de provedor/esteira da análise de crédito.
CREATE TABLE IF NOT EXISTS "CreditAnalysisRequest" (
  "id"                         TEXT NOT NULL,
  "orgId"                      TEXT NOT NULL,
  "userId"                     TEXT,
  "proposalId"                 TEXT,
  "dealId"                     TEXT,
  "provider"                   TEXT NOT NULL,
  "purpose"                    TEXT NOT NULL DEFAULT 'locacao',
  "externalId"                 TEXT,
  "status"                     TEXT NOT NULL DEFAULT 'pending',
  "batchId"                    TEXT,
  "requestJson"                JSONB,
  "resultJson"                 JSONB,
  "reportUrl"                  TEXT,
  "reportProposalAttachmentId" TEXT,
  "reportDealAttachmentId"     TEXT,
  "costCents"                  INTEGER,
  "errorMessage"               TEXT,
  "submittedAt"                TIMESTAMP(3),
  "completedAt"                TIMESTAMP(3),
  "lastSyncedAt"               TIMESTAMP(3),
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditAnalysisRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditAnalysisRequest_orgId_provider_externalId_key"
  ON "CreditAnalysisRequest"("orgId", "provider", "externalId");
CREATE INDEX IF NOT EXISTS "CreditAnalysisRequest_proposalId_idx" ON "CreditAnalysisRequest"("proposalId");
CREATE INDEX IF NOT EXISTS "CreditAnalysisRequest_dealId_idx" ON "CreditAnalysisRequest"("dealId");
CREATE INDEX IF NOT EXISTS "CreditAnalysisRequest_orgId_provider_createdAt_idx"
  ON "CreditAnalysisRequest"("orgId", "provider", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FichaCertaAccount_orgId_fkey') THEN
    ALTER TABLE "FichaCertaAccount" ADD CONSTRAINT "FichaCertaAccount_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAnalysisRequest_orgId_fkey') THEN
    ALTER TABLE "CreditAnalysisRequest" ADD CONSTRAINT "CreditAnalysisRequest_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAnalysisRequest_proposalId_fkey') THEN
    ALTER TABLE "CreditAnalysisRequest" ADD CONSTRAINT "CreditAnalysisRequest_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAnalysisRequest_dealId_fkey') THEN
    ALTER TABLE "CreditAnalysisRequest" ADD CONSTRAINT "CreditAnalysisRequest_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CertidaoJob_proposalId_fkey') THEN
    ALTER TABLE "CertidaoJob" ADD CONSTRAINT "CertidaoJob_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CertidaoJob_creditRequestId_fkey') THEN
    ALTER TABLE "CertidaoJob" ADD CONSTRAINT "CertidaoJob_creditRequestId_fkey"
      FOREIGN KEY ("creditRequestId") REFERENCES "CreditAnalysisRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
