-- AIUsage: dimensões analíticas (session/deal) — colunas simples sem FK,
-- mesma filosofia do contractId (sobrevivem à deleção do registro-pai).
ALTER TABLE "AIUsage" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "AIUsage" ADD COLUMN IF NOT EXISTS "dealId" TEXT;

-- Deal.clientName denormalizado — o kanban parava de escalar carregando
-- form.dataJson inteiro por deal só pra derivar o nome do comprador.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "clientName" TEXT;

-- Backfill idempotente a partir do form vinculado (venda: compradores[0];
-- locação: locatarios[0]; fallback razao_social pra PJ). Deals sem form ou
-- sem titular ficam null — a UI trata.
UPDATE "Deal" d
SET "clientName" = src.name
FROM (
  SELECT
    dd.id,
    NULLIF(BTRIM(COALESCE(
      f."dataJson" #>> '{compradores,0,nome}',
      f."dataJson" #>> '{compradores,0,razao_social}',
      f."dataJson" #>> '{locatarios,0,nome}',
      f."dataJson" #>> '{locatarios,0,razao_social}'
    )), '') AS name
  FROM "Deal" dd
  JOIN "SalesForm" f ON f.id = dd."formId"
  WHERE dd."clientName" IS NULL
) src
WHERE d.id = src.id
  AND src.name IS NOT NULL;
