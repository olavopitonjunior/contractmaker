-- ContractTemplate.sourceHash — SHA-256 (hex) do DOCX ORIGINAL da ingestão
-- "modelo da imobiliária → template". É a IDENTIDADE do modelo pro dedup do
-- upload em lote: reenviar o mesmo arquivo devolve 409 DUPLICATE_TEMPLATE em
-- vez de criar mais um draft. Não confundir com `previewSourceHash`, que é o
-- hash do handlebarsSource usado no cache de preview.
-- Aditiva e idempotente (migrate deploy roda no build). Nullable SEM default:
-- templates existentes (canônicos e drafts anteriores) ficam NULL e nunca
-- participam do dedup — só o que subir daqui pra frente carrega hash.
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "sourceHash" TEXT;

CREATE INDEX IF NOT EXISTS "ContractTemplate_orgId_sourceHash_idx"
  ON "ContractTemplate" ("orgId", "sourceHash");
