-- SuperlogicaAccount — conexão da imobiliária com a Superlógica Imobiliárias
-- (ERP financeiro): app_token/access_token cifrados (AES-256-GCM) + padrões da
-- exportação de vendas. Uma por org. Idempotente (IF NOT EXISTS) pra
-- sobreviver a re-run em prod/staging, como a migration da ClickSignAccount.

CREATE TABLE IF NOT EXISTS "SuperlogicaAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "licenca" TEXT NOT NULL,
    "appTokenEncrypted" TEXT NOT NULL,
    "appTokenIvBase64" TEXT NOT NULL,
    "appTokenTagBase64" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "accessTokenIvBase64" TEXT NOT NULL,
    "accessTokenTagBase64" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "accountName" TEXT,
    "connectedById" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "contaBancariaId" INTEGER,
    "filialId" INTEGER NOT NULL DEFAULT 0,
    "contaContabilComissao" TEXT NOT NULL DEFAULT '2.2.1',
    "contaContabilDescricao" TEXT NOT NULL DEFAULT 'Comissões',
    "tipoImovelPadrao" INTEGER NOT NULL DEFAULT 4,
    "tipoPagamentoComissao" INTEGER NOT NULL DEFAULT 0,
    "tipoRecebimentoComissao" INTEGER NOT NULL DEFAULT 0,
    "emitirNf" BOOLEAN NOT NULL DEFAULT false,
    "gerarDimob" BOOLEAN NOT NULL DEFAULT false,
    "vencimentoDias" INTEGER NOT NULL DEFAULT 7,
    "tetoValorCents" INTEGER NOT NULL DEFAULT 500000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperlogicaAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuperlogicaAccount_orgId_key" ON "SuperlogicaAccount"("orgId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SuperlogicaAccount_orgId_fkey'
  ) THEN
    ALTER TABLE "SuperlogicaAccount"
      ADD CONSTRAINT "SuperlogicaAccount_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
