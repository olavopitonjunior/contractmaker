-- Locação — Superlógica-parity (28/05/2026)
-- Aditivo sobre 20260527120000_locacao_fase1_foundation.
-- Adiciona 9 entidades (PropertyOwnership N:N, LeaseTenant N:N, LeaseAngariador,
-- Expense, ChecklistTemplate, Checklist, DebtAgreement, InsurancePolicy, Maintenance)
-- + 12 colunas fiscais/operacionais em LeaseContract (A5/A7-A13/A16)
-- + tipoDimob em Property (A15)
-- + caucaoSubtipo em Guarantee (A4)
-- + kind/debtAgreementId em RentCharge (A18)
-- + nfse* em AsaasTransfer (A16)
-- + backfill Property.ownerId → PropertyOwnership e LeaseContract.tenantId → LeaseTenant
-- + remoção das FK/colunas 1:1 originais.
-- Idempotente: re-execução não duplica.

-- ============================================
-- ALTER COLUMNS (idempotente)
-- ============================================

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "tipoDimob" TEXT NOT NULL DEFAULT 'urbano';

ALTER TABLE "LeaseContract"
  ADD COLUMN IF NOT EXISTS "finalidade" TEXT NOT NULL DEFAULT 'residencial',
  ADD COLUMN IF NOT EXISTS "regimeCobranca" TEXT NOT NULL DEFAULT 'mes_a_vencer',
  ADD COLUMN IF NOT EXISTS "regimeIr" TEXT NOT NULL DEFAULT 'nao_retem',
  ADD COLUMN IF NOT EXISTS "repasseTipo" TEXT NOT NULL DEFAULT 'dias_uteis_apos',
  ADD COLUMN IF NOT EXISTS "repasseGarantido" TEXT NOT NULL DEFAULT 'nao',
  ADD COLUMN IF NOT EXISTS "repasseGarantidoMeses" INTEGER,
  ADD COLUMN IF NOT EXISTS "repasseGarantidoEscopo" TEXT,
  ADD COLUMN IF NOT EXISTS "isencaoMultaMeses" INTEGER,
  ADD COLUMN IF NOT EXISTS "enderecoCobrancaTipo" TEXT NOT NULL DEFAULT 'imovel',
  ADD COLUMN IF NOT EXISTS "enderecoCobrancaJson" JSONB,
  ADD COLUMN IF NOT EXISTS "emitirNfse" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RentCharge"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'aluguel',
  ADD COLUMN IF NOT EXISTS "debtAgreementId" TEXT;

ALTER TABLE "Guarantee"
  ADD COLUMN IF NOT EXISTS "caucaoSubtipo" TEXT;

ALTER TABLE "AsaasTransfer"
  ADD COLUMN IF NOT EXISTS "nfseRequerida" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nfseEmitida" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nfseNumero" TEXT,
  ADD COLUMN IF NOT EXISTS "nfseUrl" TEXT;

-- ============================================
-- CREATE TABLES (idempotente)
-- ============================================

CREATE TABLE IF NOT EXISTS "PropertyOwnership" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "percentual" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "tipo" TEXT NOT NULL DEFAULT 'proprietario',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PropertyOwnership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaseTenant" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'solidario',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaseTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaseAngariador" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "formaComissao" TEXT NOT NULL DEFAULT 'percentual',
  "percentual" DOUBLE PRECISION,
  "valorFixo" DOUBLE PRECISION,
  "mesesComissao" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaseAngariador_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT,
  "propertyId" TEXT,
  "type" TEXT NOT NULL,
  "descricao" TEXT,
  "valor" DOUBLE PRECISION NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "parcelaN" INTEGER NOT NULL DEFAULT 1,
  "parcelaTotal" INTEGER NOT NULL DEFAULT 1,
  "debitoDe" TEXT NOT NULL,
  "creditoPara" TEXT NOT NULL,
  "rentChargeId" TEXT,
  "fornecedorId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pendente',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "itensJson" JSONB NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Checklist" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT NOT NULL,
  "templateId" TEXT,
  "nome" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pendente',
  "itensJson" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DebtAgreement" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "valorTotal" DOUBLE PRECISION NOT NULL,
  "componentesJson" JSONB NOT NULL,
  "parcelas" INTEGER NOT NULL,
  "primeiraDataDue" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ativo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DebtAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InsurancePolicy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leaseContractId" TEXT,
  "propertyId" TEXT,
  "tipo" TEXT NOT NULL,
  "seguradora" TEXT NOT NULL,
  "apoliceNumero" TEXT,
  "vigenciaInicio" TIMESTAMP(3) NOT NULL,
  "vigenciaFim" TIMESTAMP(3) NOT NULL,
  "premioMensal" DOUBLE PRECISION,
  "responsavelPagamento" TEXT,
  "coberturaJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'ativa',
  "pdfUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Maintenance" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "leaseContractId" TEXT,
  "tipo" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "fornecedorId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'solicitada',
  "custoEstimado" DOUBLE PRECISION,
  "custoFinal" DOUBLE PRECISION,
  "debitoDe" TEXT,
  "expenseId" TEXT,
  "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluidaEm" TIMESTAMP(3),
  CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- INDEXES (idempotente)
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyOwnership_propertyId_ownerId_key"
  ON "PropertyOwnership" ("propertyId", "ownerId");
CREATE INDEX IF NOT EXISTS "PropertyOwnership_orgId_propertyId_idx"
  ON "PropertyOwnership" ("orgId", "propertyId");

CREATE UNIQUE INDEX IF NOT EXISTS "LeaseTenant_leaseContractId_tenantId_key"
  ON "LeaseTenant" ("leaseContractId", "tenantId");
CREATE INDEX IF NOT EXISTS "LeaseTenant_orgId_leaseContractId_idx"
  ON "LeaseTenant" ("orgId", "leaseContractId");

CREATE INDEX IF NOT EXISTS "LeaseAngariador_orgId_leaseContractId_idx"
  ON "LeaseAngariador" ("orgId", "leaseContractId");

CREATE INDEX IF NOT EXISTS "Expense_orgId_dueDate_status_idx"
  ON "Expense" ("orgId", "dueDate", "status");
CREATE INDEX IF NOT EXISTS "Expense_leaseContractId_status_idx"
  ON "Expense" ("leaseContractId", "status");
CREATE INDEX IF NOT EXISTS "Expense_rentChargeId_idx"
  ON "Expense" ("rentChargeId");

CREATE UNIQUE INDEX IF NOT EXISTS "ChecklistTemplate_orgId_nome_key"
  ON "ChecklistTemplate" ("orgId", "nome");

CREATE INDEX IF NOT EXISTS "Checklist_orgId_status_idx"
  ON "Checklist" ("orgId", "status");
CREATE INDEX IF NOT EXISTS "Checklist_leaseContractId_status_idx"
  ON "Checklist" ("leaseContractId", "status");

CREATE INDEX IF NOT EXISTS "DebtAgreement_orgId_status_idx"
  ON "DebtAgreement" ("orgId", "status");

CREATE INDEX IF NOT EXISTS "InsurancePolicy_orgId_vigenciaFim_status_idx"
  ON "InsurancePolicy" ("orgId", "vigenciaFim", "status");

CREATE INDEX IF NOT EXISTS "Maintenance_orgId_status_idx"
  ON "Maintenance" ("orgId", "status");
CREATE INDEX IF NOT EXISTS "Maintenance_propertyId_status_idx"
  ON "Maintenance" ("propertyId", "status");

CREATE INDEX IF NOT EXISTS "RentCharge_debtAgreementId_idx"
  ON "RentCharge" ("debtAgreementId");

-- ============================================
-- FOREIGN KEYS (idempotente — DO block)
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PropertyOwnership_orgId_fkey') THEN
    ALTER TABLE "PropertyOwnership" ADD CONSTRAINT "PropertyOwnership_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PropertyOwnership_propertyId_fkey') THEN
    ALTER TABLE "PropertyOwnership" ADD CONSTRAINT "PropertyOwnership_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PropertyOwnership_ownerId_fkey') THEN
    ALTER TABLE "PropertyOwnership" ADD CONSTRAINT "PropertyOwnership_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "PropertyOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseTenant_orgId_fkey') THEN
    ALTER TABLE "LeaseTenant" ADD CONSTRAINT "LeaseTenant_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseTenant_leaseContractId_fkey') THEN
    ALTER TABLE "LeaseTenant" ADD CONSTRAINT "LeaseTenant_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseTenant_tenantId_fkey') THEN
    ALTER TABLE "LeaseTenant" ADD CONSTRAINT "LeaseTenant_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseAngariador_orgId_fkey') THEN
    ALTER TABLE "LeaseAngariador" ADD CONSTRAINT "LeaseAngariador_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseAngariador_leaseContractId_fkey') THEN
    ALTER TABLE "LeaseAngariador" ADD CONSTRAINT "LeaseAngariador_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaseAngariador_partyId_fkey') THEN
    ALTER TABLE "LeaseAngariador" ADD CONSTRAINT "LeaseAngariador_partyId_fkey"
      FOREIGN KEY ("partyId") REFERENCES "PropertyOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_orgId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_leaseContractId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_propertyId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_rentChargeId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_rentChargeId_fkey"
      FOREIGN KEY ("rentChargeId") REFERENCES "RentCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChecklistTemplate_orgId_fkey') THEN
    ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Checklist_orgId_fkey') THEN
    ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Checklist_leaseContractId_fkey') THEN
    ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Checklist_templateId_fkey') THEN
    ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DebtAgreement_orgId_fkey') THEN
    ALTER TABLE "DebtAgreement" ADD CONSTRAINT "DebtAgreement_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DebtAgreement_leaseContractId_fkey') THEN
    ALTER TABLE "DebtAgreement" ADD CONSTRAINT "DebtAgreement_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DebtAgreement_tenantId_fkey') THEN
    ALTER TABLE "DebtAgreement" ADD CONSTRAINT "DebtAgreement_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InsurancePolicy_orgId_fkey') THEN
    ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InsurancePolicy_leaseContractId_fkey') THEN
    ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InsurancePolicy_propertyId_fkey') THEN
    ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Maintenance_orgId_fkey') THEN
    ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Maintenance_propertyId_fkey') THEN
    ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Maintenance_leaseContractId_fkey') THEN
    ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_leaseContractId_fkey"
      FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RentCharge_debtAgreementId_fkey') THEN
    ALTER TABLE "RentCharge" ADD CONSTRAINT "RentCharge_debtAgreementId_fkey"
      FOREIGN KEY ("debtAgreementId") REFERENCES "DebtAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================
-- BACKFILL: Property.ownerId → PropertyOwnership
-- ============================================
-- Toda Property com ownerId setado vira PropertyOwnership(percentual=100, tipo=proprietario_principal).
-- ON CONFLICT DO NOTHING garante idempotência se a migration rodar de novo.
INSERT INTO "PropertyOwnership" ("id", "orgId", "propertyId", "ownerId", "percentual", "tipo")
SELECT
  'po_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
  p."orgId",
  p."id",
  p."ownerId",
  100,
  'proprietario_principal'
FROM "Property" p
WHERE p."ownerId" IS NOT NULL
ON CONFLICT ("propertyId", "ownerId") DO NOTHING;

-- ============================================
-- BACKFILL: LeaseContract.tenantId → LeaseTenant
-- ============================================
INSERT INTO "LeaseTenant" ("id", "orgId", "leaseContractId", "tenantId", "tipo")
SELECT
  'lt_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
  lc."orgId",
  lc."id",
  lc."tenantId",
  'titular'
FROM "LeaseContract" lc
WHERE lc."tenantId" IS NOT NULL
ON CONFLICT ("leaseContractId", "tenantId") DO NOTHING;

-- ============================================
-- DROP COLUMNS após backfill (idempotente via IF EXISTS)
-- ============================================

-- Property.ownerId
ALTER TABLE "Property" DROP CONSTRAINT IF EXISTS "Property_ownerId_fkey";
DROP INDEX IF EXISTS "Property_ownerId_idx";
ALTER TABLE "Property" DROP COLUMN IF EXISTS "ownerId";

-- LeaseContract.tenantId
ALTER TABLE "LeaseContract" DROP CONSTRAINT IF EXISTS "LeaseContract_tenantId_fkey";
DROP INDEX IF EXISTS "LeaseContract_tenantId_idx";
ALTER TABLE "LeaseContract" DROP COLUMN IF EXISTS "tenantId";

-- ============================================
-- ALTER UNIQUE em RentCharge (kind agora faz parte da chave)
-- ============================================
-- Drop o unique (leaseContractId, competencia) e cria (leaseContractId, competencia, kind).
-- Idempotente: drop só se existe, create só se não existe.
ALTER TABLE "RentCharge"
  DROP CONSTRAINT IF EXISTS "RentCharge_leaseContractId_competencia_key";
DROP INDEX IF EXISTS "RentCharge_leaseContractId_competencia_key";

CREATE UNIQUE INDEX IF NOT EXISTS "RentCharge_leaseContractId_competencia_kind_key"
  ON "RentCharge" ("leaseContractId", "competencia", "kind");
