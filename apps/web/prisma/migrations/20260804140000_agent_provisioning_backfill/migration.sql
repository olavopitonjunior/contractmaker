-- Backfill de AgentProvisioning para as orgs que o Max JÁ atende.
--
-- Por que existe: os primeiros tenants foram provisionados por script em
-- 2026-08-03, ANTES de a tabela `AgentProvisioning` existir (migration
-- 20260803210000). Eles ficaram sem linha nenhuma — e "sem linha" é um estado
-- que ninguém conserta:
--
--   * o cron `/api/cron/max/reconcile` varre apenas linhas EXISTENTES em
--     `pending_delivery`/`failed`. Org sem linha e invisivel para ele, para
--     sempre;
--   * a partir da ativacao pelo dono (`POST /api/org/max/activate`), a leitura
--     de estado passou a ser `status='active' AND deliveredAt IS NOT NULL`.
--     Sem linha, o card diria "nao ativado" e a etapa do onboarding diria
--     "aguardando ativacao" para tenants que estao no ar;
--   * e a unica acao oferecida ao dono nesse estado ROTACIONA o token
--     (`createApiToken` nao e idempotente). Um clique numa org saudavel troca
--     a credencial que o servico do Max ja tem; se o push falhar no mesmo
--     ciclo, o agente cai para aquele tenant ate a proxima reconciliacao.
--
-- O criterio e `lastUsedAt IS NOT NULL`, e nao "existe token": um token que o
-- servico do Max efetivamente USOU e prova mais forte de entrega do que o
-- recibo do push original. Token emitido e nunca usado NAO entra — seria
-- exatamente o "ativo sem confirmacao" que a leitura por `deliveredAt` existe
-- para nao afirmar.
--
-- Idempotente: `WHERE NOT EXISTS` na linha e no `@@unique([orgId, agentKey])`.
-- Reexecutar nao altera nada, e nenhuma linha ja gravada pelo fluxo normal e
-- sobrescrita.
--
-- `DISTINCT ON (orgId)` nao e defensividade vazia: `provisionMaxForOrg` emite o
-- token novo ANTES de revogar o anterior, entao existe uma janela (e um modo de
-- falha) em que a org tem dois tokens vivos. Como `NOT EXISTS` e avaliado no
-- snapshot ANTERIOR ao statement, sem isto as duas linhas passariam pelo filtro
-- e o INSERT morreria no unique — derrubando o `migrate deploy` do build.

INSERT INTO "AgentProvisioning" (
  "id", "orgId", "agentKey", "status", "serviceUserId", "tokenId",
  "deliveredAt", "lastError", "attempts", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (m."orgId")
  'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  m."orgId",
  'max',
  'active',
  u."id",
  t."id",
  -- A entrega observada e o primeiro uso do token pelo servico, nao agora.
  t."lastUsedAt",
  NULL,
  0,
  t."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
JOIN "OrgMembership" m ON m."userId" = u."id"
JOIN "UserApiToken" t ON t."userId" = u."id" AND t."revokedAt" IS NULL
WHERE u."email" = 'max+' || m."orgId" || '@agents.imobpro.local'
  AND t."lastUsedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AgentProvisioning" a
    WHERE a."orgId" = m."orgId" AND a."agentKey" = 'max'
  )
-- Empatando por token mais recente: e o que sobrevive a revogacao do anterior.
ORDER BY m."orgId", t."createdAt" DESC;
