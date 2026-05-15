-- Migration: Deal.complianceJson
--
-- Adiciona campo opcional pra registro de consentimentos LGPD por deal.
-- Inicialmente usado pelo pipeline Serasa (score/restritivos/vinculos)
-- que exige consentimento explicito antes do dispatch — sem ele, POST
-- /api/deals/[id]/certidoes retorna 412 quando o batch inclui Serasa.
--
-- Shape esperado:
--   {
--     "serasaConsent": {
--       "at": "2026-05-15T10:00:00Z",
--       "by": "<userId>",
--       "baseLegal": "protecao_credito" | "execucao_contrato"
--     }
--   }
--
-- Idempotente (IF NOT EXISTS) pra suportar replays do migrate deploy.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "complianceJson" JSONB;
