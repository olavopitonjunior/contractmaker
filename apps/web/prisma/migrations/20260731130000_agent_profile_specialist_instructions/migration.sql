-- Preserva as instruções do tenant nos 4 especialistas.
--
-- Antes do AgentProfile, `AgentConfig.systemPrompt` tinha DOIS destinos:
--   1. o agente legado, onde SUBSTITUÍA o prompt default; e
--   2. os 4 especialistas do orquestrador (caminho DEFAULT do chat), onde
--      entrava como bloco <instrucoes_da_imobiliaria> via
--      getTenantAgentInstructions.
--
-- A migration 20260731090000 só cobriu o destino 1 (agentKey='chat_legacy').
-- Sem esta, a instrução que a imobiliária escreveu pararia de chegar ao chat
-- que ela realmente usa — regressão silenciosa, achada verificando a org de
-- producao (systemPrompt de 739 chars, texto proprio).
--
-- Migration separada em vez de editar a anterior: aquela ja foi aplicada em
-- staging, e `migrate deploy` recusa migration aplicada cujo checksum mudou.
--
-- O filtro de tamanho reproduz o guard que existia em código: o loader antigo
-- devolvia null quando o texto era IGUAL ao DEFAULT_SYSTEM_PROMPT (~24.8k
-- chars) — isto é, "o tenant colou o prompt inteiro" nunca contou como
-- instrução adicional. 20k é o corte conservador pra mesma intenção.
INSERT INTO "AgentProfile" ("id", "orgId", "agentKey", "instructions", "createdAt", "updatedAt")
SELECT
  'agp_' || a."orgId" || '_' || k.agent_key,
  a."orgId",
  k.agent_key,
  TRIM(a."systemPrompt"),
  COALESCE(a."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "AgentConfig" a
CROSS JOIN (VALUES ('analyst'), ('legal'), ('editor'), ('curator')) AS k(agent_key)
WHERE length(TRIM(a."systemPrompt")) BETWEEN 1 AND 20000
ON CONFLICT DO NOTHING;
