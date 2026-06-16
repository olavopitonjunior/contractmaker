-- DiligentedPerson: campos que destravam certidões de PF avulsa.
-- rg → TJSP pedido-certidao; nomeMae → antecedentes criminais; sexo → genero TJSP.
-- Nullable + IF NOT EXISTS = idempotente, sem default, não quebra linhas existentes.
ALTER TABLE "DiligentedPerson" ADD COLUMN IF NOT EXISTS "rg" TEXT;
ALTER TABLE "DiligentedPerson" ADD COLUMN IF NOT EXISTS "nomeMae" TEXT;
ALTER TABLE "DiligentedPerson" ADD COLUMN IF NOT EXISTS "sexo" TEXT;
