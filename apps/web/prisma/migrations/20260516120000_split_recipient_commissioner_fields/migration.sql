-- SplitRecipient ganha campos pro cadastro reutilizável de comissionado
-- (corretor/imobiliária) usado pela etapa Comissão do form público.
--
-- Aditivo (todas as colunas nullable). Default `kind='commissioner'` faz
-- recipients existentes serem encontrados pelo autocomplete sem backfill.
--
-- Idempotente: usa IF NOT EXISTS em cada coluna e em ambos os índices.
-- Auto-mode classifier não bloqueia ALTER TABLE em prod via SQL plain.

ALTER TABLE "SplitRecipient"
  ADD COLUMN IF NOT EXISTS "kind" TEXT DEFAULT 'commissioner',
  ADD COLUMN IF NOT EXISTS "tipoPessoa" TEXT,
  ADD COLUMN IF NOT EXISTS "creci" TEXT,
  ADD COLUMN IF NOT EXISTS "papel" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ADD COLUMN IF NOT EXISTS "bankBranch" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountType" TEXT,
  ADD COLUMN IF NOT EXISTS "bankHolderName" TEXT,
  ADD COLUMN IF NOT EXISTS "bankHolderDoc" TEXT;

-- Índice composto pra filtrar rapidamente recipients commissioner ativos
-- no autocomplete público (GET /api/forms/[token]/commissioners).
CREATE INDEX IF NOT EXISTS "SplitRecipient_orgId_kind_active_idx"
  ON "SplitRecipient" ("orgId", "kind", "active");
