-- ContractTemplate.matchCriteria — critério de seleção pelas escolhas do FORM
-- (locação/proposta), além da modalidade. Shape: { garantia?, fiadorPessoa?, pessoa? }.
-- Aditiva e idempotente (migrate deploy roda no build). Nullable SEM default:
-- rows existentes ficam NULL = template genérico da modalidade, ou seja a
-- seleção continua exatamente como antes até alguém marcar uma variante.
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "matchCriteria" JSONB;
