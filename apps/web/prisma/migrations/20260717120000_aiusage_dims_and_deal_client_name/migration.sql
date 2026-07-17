-- AIUsage: dimensões analíticas (session/deal) — colunas simples sem FK,
-- mesma filosofia do contractId (sobrevivem à deleção do registro-pai).
ALTER TABLE "AIUsage" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "AIUsage" ADD COLUMN IF NOT EXISTS "dealId" TEXT;

-- Deal.clientName denormalizado — o kanban parava de escalar carregando
-- form.dataJson inteiro por deal só pra derivar o nome do comprador.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "clientName" TEXT;

-- Índice pro cron de retenção (subquery filtra action + createdAt em batches;
-- os índices existentes têm a data como coluna não-líder).
CREATE INDEX IF NOT EXISTS "ContractChangeLog_action_createdAt_idx"
  ON "ContractChangeLog"("action", "createdAt");

-- Backfill idempotente a partir do form vinculado (venda: compradores[0];
-- locação: locatarios[0]). NULLIF(BTRIM(...)) POR CAMPO, antes do COALESCE:
-- `nome: ""` (artefato comum de autosave em partes PJ) não pode sombrear a
-- razao_social. Deals sem form ou sem titular ficam null — a UI trata.
UPDATE "Deal" d
SET "clientName" = src.name
FROM (
  SELECT
    dd.id,
    COALESCE(
      NULLIF(BTRIM(f."dataJson" #>> '{compradores,0,nome}'), ''),
      NULLIF(BTRIM(f."dataJson" #>> '{compradores,0,razao_social}'), ''),
      NULLIF(BTRIM(f."dataJson" #>> '{locatarios,0,nome}'), ''),
      NULLIF(BTRIM(f."dataJson" #>> '{locatarios,0,razao_social}'), '')
    ) AS name
  FROM "Deal" dd
  JOIN "SalesForm" f ON f.id = dd."formId"
  WHERE dd."clientName" IS NULL
) src
WHERE d.id = src.id
  AND src.name IS NOT NULL;
