-- Propostas comerciais (vendas + locação).
--
-- A proposta é o passo ANTES do negócio: o proponente oferece um valor, o
-- proprietário aceita ou não. Vive FORA do kanban e, quando aceita, converte em
-- Deal + SalesForm com o dataJson já preenchido (elimina a redigitação).
--
-- Aditivo e idempotente (roda 2x sem erro). Nenhuma row existente é alterada:
-- todo Envelope atual tem dealId NOT NULL e exatamente um sujeito, então
-- satisfaz os CHECKs novos por construção.
--
-- Ver plano: docs/prd-propostas.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabelas novas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Proposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaType" TEXT NOT NULL DEFAULT 'compra_venda_v1',
    "kind" TEXT NOT NULL DEFAULT 'venda',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "instrument" TEXT NOT NULL DEFAULT 'envelope',
    "acceptanceClicksignId" TEXT,
    "templateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "htmlContent" TEXT,
    "googleDocId" TEXT,
    "googleDocUrl" TEXT,
    "googleDocStatus" TEXT,
    "comissaoIncluida" BOOLEAN NOT NULL DEFAULT false,
    "hiddenPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "token" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "refusedBy" TEXT,
    "refusedAt" TIMESTAMP(3),
    "refusedReason" TEXT,
    "counterAmount" DOUBLE PRECISION,
    "parentProposalId" TEXT,
    "round" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "expiredAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dossierUrl" TEXT,
    "dossierBuiltAt" TIMESTAMP(3),
    "lastError" TEXT,
    "reservedCostCents" INTEGER NOT NULL DEFAULT 0,
    "propertyId" TEXT,
    "leaseClientId" TEXT,
    "tenantId" TEXT,
    "crmRef" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "convertedDealId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedWithoutSignature" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProposalSigner" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "cpf" TEXT,
    "phone" TEXT,
    "percentual" DOUBLE PRECISION,
    "signingGroup" INTEGER NOT NULL DEFAULT 1,
    "notifyChannel" TEXT NOT NULL DEFAULT 'email',
    "included" BOOLEAN NOT NULL DEFAULT true,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalSigner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProposalAttachment" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "contentHash" TEXT,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProposalEvent" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB,
    "source" TEXT NOT NULL DEFAULT 'system',
    "ipHash" TEXT,
    "userAgent" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalEvent_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Colunas novas em tabelas existentes
-- ─────────────────────────────────────────────────────────────────────────────

-- Envelope: passa a aceitar PROPOSTA como sujeito e como pai.
-- `dealId` vira nullable porque a proposta vive fora do kanban — o Deal só nasce
-- na conversão. Envelope tem `orgId` próprio, então os guards cross-org (que
-- usam envelope.orgId) continuam de pé; nada de IDOR aqui.
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "proposalId" TEXT;
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "via" TEXT;
ALTER TABLE "Envelope" ALTER COLUMN "dealId" DROP NOT NULL;

-- EnvelopeSigner:
--  · email nullable — o signatário do lado proprietário vem de PropertyOwner,
--    cujo email é opcional e cujo canal preferido é WhatsApp. A correlação do
--    webhook não depende mais do e-mail (usa signer.key → clicksignId).
--  · notifyChannel — communicate_events.signature_request da v3. Eixo ORTOGONAL
--    ao authMethod (que é o requirement de autenticação).
--  · signatureKey — `key` do signatário, usada pra carregar o widget embedado.
ALTER TABLE "EnvelopeSigner" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "notifyChannel" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "signatureKey" TEXT;

-- OrgSignatureSettings: sub-orçamento de propostas + gate do Aceite via WhatsApp.
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "proposalBudgetCents" INTEGER;
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "acceptanceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_token_key" ON "Proposal"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_convertedDealId_key" ON "Proposal"("convertedDealId");
CREATE INDEX IF NOT EXISTS "Proposal_orgId_status_idx" ON "Proposal"("orgId", "status");
CREATE INDEX IF NOT EXISTS "Proposal_orgId_userId_idx" ON "Proposal"("orgId", "userId");
CREATE INDEX IF NOT EXISTS "Proposal_status_validUntil_idx" ON "Proposal"("status", "validUntil");
CREATE INDEX IF NOT EXISTS "Proposal_propertyId_status_idx" ON "Proposal"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "Proposal_parentProposalId_idx" ON "Proposal"("parentProposalId");

-- Backstop da regra "sem duplicidade de signatário". Hoje o mesmo CPF duas vezes
-- no envelope gera COBRANÇA DOBRADA e o webhook marca um dos dois ao acaso.
CREATE UNIQUE INDEX IF NOT EXISTS "ProposalSigner_proposalId_dedupeKey_key"
  ON "ProposalSigner"("proposalId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "ProposalSigner_proposalId_idx" ON "ProposalSigner"("proposalId");

CREATE INDEX IF NOT EXISTS "ProposalAttachment_proposalId_idx" ON "ProposalAttachment"("proposalId");
CREATE INDEX IF NOT EXISTS "ProposalAttachment_contentHash_idx" ON "ProposalAttachment"("contentHash");
CREATE INDEX IF NOT EXISTS "ProposalEvent_proposalId_receivedAt_idx" ON "ProposalEvent"("proposalId", "receivedAt");

CREATE INDEX IF NOT EXISTS "Envelope_proposalId_idx" ON "Envelope"("proposalId");
-- Idempotência FÍSICA do encadeamento das duas vias: no máximo 1 envelope por
-- (proposta, via). Webhook `close` reentregue não consegue criar um 2º envelope
-- da via reduzida — o banco recusa, e o P2002 é tratado como sucesso.
CREATE UNIQUE INDEX IF NOT EXISTS "Envelope_proposalId_via_key" ON "Envelope"("proposalId", "via");

-- ─────────────────────────────────────────────────────────────────────────────
-- Foreign keys (guardadas por pg_constraint — idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_orgId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_userId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_templateId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_propertyId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_leaseClientId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leaseClientId_fkey"
      FOREIGN KEY ("leaseClientId") REFERENCES "LeaseClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_tenantId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_convertedDealId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_convertedDealId_fkey"
      FOREIGN KEY ("convertedDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_parentProposalId_fkey') THEN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_parentProposalId_fkey"
      FOREIGN KEY ("parentProposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProposalSigner_proposalId_fkey') THEN
    ALTER TABLE "ProposalSigner" ADD CONSTRAINT "ProposalSigner_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProposalAttachment_proposalId_fkey') THEN
    ALTER TABLE "ProposalAttachment" ADD CONSTRAINT "ProposalAttachment_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProposalEvent_proposalId_fkey') THEN
    ALTER TABLE "ProposalEvent" ADD CONSTRAINT "ProposalEvent_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Envelope_proposalId_fkey') THEN
    ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK constraints do Envelope
-- ─────────────────────────────────────────────────────────────────────────────
-- O `envelope_source_xor` original (migration 20260508130000) é uma OR-chain de
-- DUAS vias e REJEITARIA um envelope de proposta (contractId e attachmentId
-- ambos NULL). Precisa ser substituído por dois CHECKs mais gerais.
--
-- A troca é SEGURA sem backfill: toda row existente tem dealId NOT NULL e
-- exatamente um de (contractId, attachmentId) — satisfaz os dois CHECKs novos
-- por construção. Drop + add rodam na MESMA transação da migration, então não há
-- janela em que a tabela fique sem proteção.
--
-- Num envelope de proposta o `proposalId` cumpre os DOIS papéis (sujeito e pai),
-- então ambos os CHECKs passam com contractId/attachmentId/dealId todos NULL.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envelope_source_xor') THEN
    ALTER TABLE "Envelope" DROP CONSTRAINT "envelope_source_xor";
  END IF;

  -- Sujeito: exatamente 1 de (contract | attachment | proposal).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envelope_subject_xor') THEN
    ALTER TABLE "Envelope" ADD CONSTRAINT "envelope_subject_xor"
      CHECK (num_nonnulls("contractId", "attachmentId", "proposalId") = 1);
  END IF;

  -- Pai: exatamente 1 de (deal | proposal).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envelope_parent_xor') THEN
    ALTER TABLE "Envelope" ADD CONSTRAINT "envelope_parent_xor"
      CHECK (num_nonnulls("dealId", "proposalId") = 1);
  END IF;

  -- `via` só existe (e é obrigatória) em envelope de proposta.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envelope_via_check') THEN
    ALTER TABLE "Envelope" ADD CONSTRAINT "envelope_via_check"
      CHECK (
        ("proposalId" IS NULL AND "via" IS NULL) OR
        ("proposalId" IS NOT NULL AND "via" IN ('completa', 'reduzida'))
      );
  END IF;
END $$;
