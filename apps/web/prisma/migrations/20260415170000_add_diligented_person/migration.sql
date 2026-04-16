-- F3: Pessoas diligenciadas (externas ao contrato)
CREATE TABLE "DiligentedPerson" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tipoPessoa" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "cnpj" TEXT,
    "dataNascimento" TEXT,
    "uf" TEXT,
    "cidade" TEXT,
    "relacao" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiligentedPerson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiligentedPerson_dealId_idx" ON "DiligentedPerson"("dealId");

ALTER TABLE "DiligentedPerson"
  ADD CONSTRAINT "DiligentedPerson_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
