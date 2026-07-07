-- Invariante isLatest passa a ser POR KIND: um deal pode ter simultaneamente
-- o instrumento principal (kind="contract"), aditamentos (kind="addendum") e o
-- contrato de administração de locação (kind="administracao"), cada um com sua
-- própria versão latest.
--
-- O índice antigo (por dealId apenas) fazia o create de um segundo instrumento
-- com isLatest=true colidir — inclusive o aditamento já violava a constraint
-- em deals com contrato existente (addendum-generation criava isLatest=true
-- sem rebaixar ninguém).
--
-- Dados existentes: o índice antigo (mais estrito) garante no máximo 1 latest
-- por deal, então o novo índice (mais frouxo) é satisfeito trivialmente.
-- Idempotente: DROP IF EXISTS + CREATE IF NOT EXISTS.

DROP INDEX IF EXISTS "Contract_dealId_isLatest_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "Contract_dealId_kind_isLatest_unique"
  ON "Contract" ("dealId", "kind")
  WHERE "isLatest" = true;

-- Saneamento defensivo pro caso de algum deal ter aditamento órfão sem
-- isLatest (impossível pelo índice antigo ter no máx 1 latest/deal, mas se o
-- create do aditamento falhou e foi recriado, versões antigas de addendum
-- podem existir com isLatest=false — correto). Nada a corrigir em dados.
