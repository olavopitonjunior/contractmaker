-- Backfill SET-BASED do DealStageHistory (plano 2026-08-06, PR 3.2): todo Deal
-- SEM nenhuma linha de histórico ganha o intervalo ABERTO do stage atual, a
-- partir de COALESCE(stageEnteredAt, createdAt), marcado estimated=true.
-- Idempotente: WHERE NOT EXISTS + id determinístico ('bfh_' || dealId).
-- O passado (intervalos fechados) é reconstruído pelo script
-- scripts/backfill-deal-stage-history.ts (best-effort, a partir do AuditLog).

INSERT INTO "DealStageHistory" (
  "id", "orgId", "dealId", "kind", "stageId", "stageName", "stagePosition",
  "fromStageId", "enteredAt", "exitedAt", "durationSec",
  "slaWarnDays", "slaDangerDays", "reason", "actorUserId", "estimated", "createdAt"
)
SELECT
  'bfh_' || d."id",
  p."orgId",
  d."id",
  COALESCE(NULLIF(d."kind", ''), NULLIF(p."kind", ''), 'venda'),
  d."stageId",
  s."name",
  s."position",
  NULL,
  COALESCE(d."stageEnteredAt", d."createdAt"),
  NULL,
  NULL,
  -- Política congelada: defaults de código (5/10) — stages terminais ficam
  -- sem SLA. Nomes terminais espelham TERMINAL_STAGES_BY_KIND + LOST_STAGE_NAME.
  CASE WHEN s."name" IN ('Comissão paga', 'ADM', 'Negócio perdido') THEN NULL ELSE 5 END,
  CASE WHEN s."name" IN ('Comissão paga', 'ADM', 'Negócio perdido') THEN NULL ELSE 10 END,
  'backfill',
  NULL,
  true,
  CURRENT_TIMESTAMP
FROM "Deal" d
JOIN "Pipeline" p ON p."id" = d."pipelineId"
JOIN "PipelineStage" s ON s."id" = d."stageId"
WHERE NOT EXISTS (
  SELECT 1 FROM "DealStageHistory" h WHERE h."dealId" = d."id"
);

-- Materializa o SLA dos deals ativos backfillados (mesma regra do
-- moveDealStage: entrada + 5/10 dias; terminais ficam null).
UPDATE "Deal" d
SET
  "slaWarnAt" = COALESCE(d."stageEnteredAt", d."createdAt") + INTERVAL '5 days',
  "slaDueAt"  = COALESCE(d."stageEnteredAt", d."createdAt") + INTERVAL '10 days'
FROM "PipelineStage" s
WHERE s."id" = d."stageId"
  AND d."slaDueAt" IS NULL
  AND d."archivedAt" IS NULL
  AND d."lostAt" IS NULL
  AND s."name" NOT IN ('Comissão paga', 'ADM', 'Negócio perdido');
