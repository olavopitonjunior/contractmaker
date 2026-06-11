-- Locação Fase 1 — fundação do modelo de dados (docs/locacao/spec.md §4).
-- Aditivo e idempotente: discriminadores via ADD COLUMN IF NOT EXISTS;
-- tabelas novas via CREATE TABLE IF NOT EXISTS com FKs inline (nomes Prisma,
-- atômico com a criação da tabela); índices via CREATE [UNIQUE] INDEX IF NOT
-- EXISTS. Links a models existentes (Contract/CommissionCharge/AsaasTransfer/
-- Deal/Envelope) são colunas TEXT sem FK — por design.

-- Discriminadores de produto (retrocompat: default "venda").
ALTER TABLE "Pipeline" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'venda';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'venda';

-- PropertyOwner
CREATE TABLE IF NOT EXISTS "PropertyOwner" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tipoPessoa" TEXT NOT NULL DEFAULT 'fisica',
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "bankName" TEXT,
    "bankBranch" TEXT,
    "bankAccount" TEXT,
    "bankAccountType" TEXT,
    "asaasWalletId" TEXT,
    "canalPreferido" TEXT DEFAULT 'whatsapp',
    "repasseDia" INTEGER,
    "antecipacaoHabilitada" BOOLEAN NOT NULL DEFAULT false,
    "dataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PropertyOwner_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyOwner_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tenant
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tipoPessoa" TEXT NOT NULL DEFAULT 'fisica',
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Tenant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Property
CREATE TABLE IF NOT EXISTS "Property" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'apartamento',
    "status" TEXT NOT NULL DEFAULT 'disponivel',
    "rua" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "cep" TEXT,
    "matricula" TEXT,
    "cartorio" TEXT,
    "inscricaoIptu" TEXT,
    "area" DOUBLE PRECISION,
    "atributos" JSONB,
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "descricaoIa" TEXT,
    "valorAluguelSugerido" DOUBLE PRECISION,
    "captacaoEnvelopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Property_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Property_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "PropertyOwner"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- LeaseContract
CREATE TABLE IF NOT EXISTS "LeaseContract" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT,
    "dealId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "valorAluguel" DOUBLE PRECISION NOT NULL,
    "valorEncargos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diaVencimento" INTEGER NOT NULL DEFAULT 10,
    "indiceReajuste" TEXT NOT NULL DEFAULT 'IGPM',
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "taxaAdminPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "repasseDia" INTEGER,
    "repasseSplitJson" JSONB,
    "dataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaseContract_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeaseContract_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeaseContract_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaseContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RentCharge
CREATE TABLE IF NOT EXISTS "RentCharge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leaseContractId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "valorBase" DOUBLE PRECISION NOT NULL,
    "encargos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "juros" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "commissionChargeId" TEXT,
    "repasseTransferId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RentCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RentCharge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RentCharge_leaseContractId_fkey" FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Guarantee
CREATE TABLE IF NOT EXISTS "Guarantee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leaseContractId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "coberturaMeses" INTEGER,
    "custoJson" JSONB,
    "externalRef" TEXT,
    "fiadorPartyJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Guarantee_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Guarantee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Guarantee_leaseContractId_fkey" FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreditAnalysis
CREATE TABLE IF NOT EXISTS "CreditAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseDealId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "scoreBureau" INTEGER,
    "scoreInterno" INTEGER,
    "decisionJson" JSONB,
    "shapJson" JSONB,
    "openFinanceConsentId" TEXT,
    "biometriaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditAnalysis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreditAnalysis_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Inspection
CREATE TABLE IF NOT EXISTS "Inspection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leaseContractId" TEXT,
    "tipo" TEXT NOT NULL,
    "tipoImovel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "checklistJson" JSONB,
    "ambientesJson" JSONB,
    "comparacaoJson" JSONB,
    "laudoPdfUrl" TEXT,
    "qrToken" TEXT,
    "envelopeId" TEXT,
    "executorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Inspection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Inspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inspection_leaseContractId_fkey" FOREIGN KEY ("leaseContractId") REFERENCES "LeaseContract"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Índices (nomes idênticos aos que o Prisma espera — evita drift no migrate diff)
CREATE INDEX IF NOT EXISTS "PropertyOwner_orgId_idx" ON "PropertyOwner"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "PropertyOwner_orgId_cpfCnpj_key" ON "PropertyOwner"("orgId", "cpfCnpj");
CREATE INDEX IF NOT EXISTS "Tenant_orgId_idx" ON "Tenant"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_orgId_cpfCnpj_key" ON "Tenant"("orgId", "cpfCnpj");
CREATE INDEX IF NOT EXISTS "Property_orgId_status_idx" ON "Property"("orgId", "status");
CREATE INDEX IF NOT EXISTS "Property_ownerId_idx" ON "Property"("ownerId");
CREATE INDEX IF NOT EXISTS "LeaseContract_orgId_status_idx" ON "LeaseContract"("orgId", "status");
CREATE INDEX IF NOT EXISTS "LeaseContract_propertyId_idx" ON "LeaseContract"("propertyId");
CREATE INDEX IF NOT EXISTS "LeaseContract_tenantId_idx" ON "LeaseContract"("tenantId");
CREATE INDEX IF NOT EXISTS "RentCharge_orgId_competencia_idx" ON "RentCharge"("orgId", "competencia");
CREATE INDEX IF NOT EXISTS "RentCharge_orgId_status_idx" ON "RentCharge"("orgId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "RentCharge_leaseContractId_competencia_key" ON "RentCharge"("leaseContractId", "competencia");
CREATE UNIQUE INDEX IF NOT EXISTS "Guarantee_leaseContractId_key" ON "Guarantee"("leaseContractId");
CREATE INDEX IF NOT EXISTS "Guarantee_orgId_status_idx" ON "Guarantee"("orgId", "status");
CREATE INDEX IF NOT EXISTS "CreditAnalysis_orgId_status_idx" ON "CreditAnalysis"("orgId", "status");
CREATE INDEX IF NOT EXISTS "CreditAnalysis_tenantId_idx" ON "CreditAnalysis"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Inspection_qrToken_key" ON "Inspection"("qrToken");
CREATE INDEX IF NOT EXISTS "Inspection_orgId_status_idx" ON "Inspection"("orgId", "status");
CREATE INDEX IF NOT EXISTS "Inspection_propertyId_idx" ON "Inspection"("propertyId");
