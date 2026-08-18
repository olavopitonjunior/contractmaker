import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { WON_STAGE_BY_KIND, LOST_STAGE_NAME } from "@/lib/pipeline/stage-config";

/**
 * Relatório do pipeline (plano 2026-08-06, PR 3.7) — todas as agregações saem
 * do `DealStageHistory` (PR 3.1) via $queryRaw:
 *
 *  - tempo por etapa: PERCENTILE_CONT 0.5/0.9 sobre intervalos FECHADOS;
 *  - % dentro do SLA: compara durationSec com a política CONGELADA na entrada
 *    (slaDangerDays da própria linha — mudança de política não reescreve o
 *    passado);
 *  - passagem/conversão por etapa: COUNT(DISTINCT dealId) que ENTROU em cada
 *    etapa (um deal que ping-pongou conta 1×);
 *  - ciclo até ganho: entrada no stage terminal feliz (WON_STAGE_BY_KIND) −
 *    createdAt do deal.
 *
 * `incluirEstimados=false` (default) descarta linhas `estimated=true` das
 * MÉTRICAS DE TEMPO — duração de intervalo reconstruído do AuditLog (ou da
 * auto-cura) é chute. A contagem de passagem inclui estimados sempre: o deal
 * PASSOU pela etapa mesmo que a duração seja estimada.
 */

export interface StageTimeMetric {
  stageName: string;
  stagePosition: number;
  /** Intervalos fechados considerados (pós-filtro de estimados). */
  closedIntervals: number;
  medianDays: number | null;
  p90Days: number | null;
  /** % de intervalos fechados dentro do prazo congelado (null = sem política). */
  withinSlaPct: number | null;
  /** Deals DISTINTOS que entraram na etapa (inclui estimados). */
  dealsEntered: number;
  /** % vs a etapa anterior (posição menor imediata) — null na primeira. */
  conversionFromPrevPct: number | null;
}

export interface CycleMetrics {
  wonDeals: number;
  medianDays: number | null;
  p90Days: number | null;
}

export interface BrokerRow {
  userId: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  conversionPct: number;
  totalValue: number;
}

export interface PipelineReport {
  stages: StageTimeMetric[];
  cycle: CycleMetrics;
  byBroker: BrokerRow[];
  /** Linhas estimadas descartadas das métricas de tempo (base do banner). */
  estimatedExcluded: number;
}

export interface PipelineReportOpts {
  orgId: string;
  kind: "venda" | "locacao";
  /** Janela pela ENTRADA no intervalo (enteredAt). Omitir = tudo. */
  from?: Date;
  to?: Date;
  incluirEstimados?: boolean;
}

function windowSql(from?: Date, to?: Date): Prisma.Sql {
  return Prisma.sql`
    ${from ? Prisma.sql`AND h."enteredAt" >= ${from}` : Prisma.empty}
    ${to ? Prisma.sql`AND h."enteredAt" < ${to}` : Prisma.empty}`;
}

export async function getPipelineReport(
  opts: PipelineReportOpts
): Promise<PipelineReport> {
  const { orgId, kind, from, to, incluirEstimados = false } = opts;
  const estimadoFilter = incluirEstimados
    ? Prisma.empty
    : Prisma.sql`AND h.estimated = false`;

  // Tempo por etapa (intervalos fechados) + % dentro do SLA congelado.
  const timeRows = await prisma.$queryRaw<
    Array<{
      stageName: string;
      stagePosition: number;
      closed: bigint;
      medianSec: number | null;
      p90Sec: number | null;
      withSla: bigint;
      withinSla: bigint;
    }>
  >(Prisma.sql`
    SELECT
      h."stageName",
      MAX(h."stagePosition")::int AS "stagePosition",
      COUNT(*)::bigint AS closed,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY h."durationSec")::float8 AS "medianSec",
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY h."durationSec")::float8 AS "p90Sec",
      COUNT(*) FILTER (WHERE h."slaDangerDays" IS NOT NULL)::bigint AS "withSla",
      COUNT(*) FILTER (
        WHERE h."slaDangerDays" IS NOT NULL
          AND h."durationSec" <= h."slaDangerDays" * 86400
      )::bigint AS "withinSla"
    FROM "DealStageHistory" h
    WHERE h."orgId" = ${orgId}
      AND h.kind = ${kind}
      AND h."exitedAt" IS NOT NULL
      ${estimadoFilter}
      ${windowSql(from, to)}
    GROUP BY h."stageName"
  `);

  // Passagem por etapa — deals distintos que ENTRARAM (estimados contam).
  const passageRows = await prisma.$queryRaw<
    Array<{ stageName: string; stagePosition: number; dealsEntered: bigint }>
  >(Prisma.sql`
    SELECT
      h."stageName",
      MAX(h."stagePosition")::int AS "stagePosition",
      COUNT(DISTINCT h."dealId")::bigint AS "dealsEntered"
    FROM "DealStageHistory" h
    WHERE h."orgId" = ${orgId}
      AND h.kind = ${kind}
      ${windowSql(from, to)}
    GROUP BY h."stageName"
  `);

  // Estimadas descartadas — base do banner "há histórico estimado fora".
  const excludedRow = incluirEstimados
    ? [{ n: BigInt(0) }]
    : await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS n
        FROM "DealStageHistory" h
        WHERE h."orgId" = ${orgId}
          AND h.kind = ${kind}
          AND h."exitedAt" IS NOT NULL
          AND h.estimated = true
          ${windowSql(from, to)}
      `);

  // Ciclo criação → ganho (entrada no stage terminal feliz do kind).
  const wonStage = WON_STAGE_BY_KIND[kind];
  const cycleRows = await prisma.$queryRaw<
    Array<{ wonDeals: bigint; medianSec: number | null; p90Sec: number | null }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS "wonDeals",
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (h."enteredAt" - d."createdAt"))
      )::float8 AS "medianSec",
      PERCENTILE_CONT(0.9) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (h."enteredAt" - d."createdAt"))
      )::float8 AS "p90Sec"
    FROM "DealStageHistory" h
    JOIN "Deal" d ON d.id = h."dealId"
    WHERE h."orgId" = ${orgId}
      AND h.kind = ${kind}
      AND h."stageName" = ${wonStage}
      ${estimadoFilter}
      ${windowSql(from, to)}
  `);

  // Por corretor (Deal.userId) — desfecho igual ao funil por canal.
  const wonPredicate =
    kind === "venda"
      ? Prisma.sql`d."commissionPaidAt" IS NOT NULL`
      : Prisma.sql`s.name = ${WON_STAGE_BY_KIND.locacao}`;
  const stageJoin =
    kind === "venda"
      ? Prisma.empty
      : Prisma.sql`JOIN "PipelineStage" s ON s.id = d."stageId"`;
  const brokerRows = await prisma.$queryRaw<
    Array<{
      userId: string;
      name: string | null;
      email: string | null;
      total: bigint;
      won: bigint;
      lost: bigint;
      totalValue: number | null;
    }>
  >(Prisma.sql`
    SELECT
      d."userId",
      u.name,
      u.email,
      COUNT(*)::bigint AS total,
      SUM(CASE WHEN ${wonPredicate} THEN 1 ELSE 0 END)::bigint AS won,
      SUM(CASE WHEN d."lostAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS lost,
      SUM(COALESCE(d.value, 0))::float8 AS "totalValue"
    FROM "Deal" d
    JOIN "Pipeline" p ON p.id = d."pipelineId"
    JOIN "User" u ON u.id = d."userId"
    ${stageJoin}
    WHERE p."orgId" = ${orgId}
      AND d.kind = ${kind}
      AND d."archivedAt" IS NULL
      ${from ? Prisma.sql`AND d."createdAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND d."createdAt" < ${to}` : Prisma.empty}
    GROUP BY d."userId", u.name, u.email
    ORDER BY total DESC
  `);

  // Merge tempo × passagem por stageName; ordena por posição do funil.
  const passageByName = new Map(
    passageRows.map((r) => [r.stageName, r] as const)
  );
  const names = new Set<string>([
    ...timeRows.map((r) => r.stageName),
    ...passageRows.map((r) => r.stageName),
  ]);
  const secToDays = (sec: number | null) =>
    sec === null ? null : Math.round((sec / 86_400) * 10) / 10;

  const unsorted = [...names].map((name): StageTimeMetric => {
    const time = timeRows.find((r) => r.stageName === name);
    const passage = passageByName.get(name);
    const withSla = Number(time?.withSla ?? 0);
    return {
      stageName: name,
      stagePosition: passage?.stagePosition ?? time?.stagePosition ?? 0,
      closedIntervals: Number(time?.closed ?? 0),
      medianDays: secToDays(time?.medianSec ?? null),
      p90Days: secToDays(time?.p90Sec ?? null),
      withinSlaPct:
        withSla > 0
          ? Math.round((Number(time!.withinSla) / withSla) * 100)
          : null,
      dealsEntered: Number(passage?.dealsEntered ?? 0),
      conversionFromPrevPct: null,
    };
  });
  const stages = unsorted.sort((a, b) => a.stagePosition - b.stagePosition);
  // Conversão vs etapa anterior — perdido fica fora da cadeia linear.
  const linear = stages.filter((s) => s.stageName !== LOST_STAGE_NAME);
  for (let i = 1; i < linear.length; i++) {
    const prev = linear[i - 1];
    linear[i].conversionFromPrevPct =
      prev.dealsEntered > 0
        ? Math.round((linear[i].dealsEntered / prev.dealsEntered) * 100)
        : null;
  }

  const cycle = cycleRows[0];
  return {
    stages,
    cycle: {
      wonDeals: Number(cycle?.wonDeals ?? 0),
      medianDays: secToDays(cycle?.medianSec ?? null),
      p90Days: secToDays(cycle?.p90Sec ?? null),
    },
    byBroker: brokerRows.map((r) => {
      const total = Number(r.total);
      const won = Number(r.won);
      return {
        userId: r.userId,
        label: r.name?.trim() || r.email || r.userId,
        total,
        won,
        lost: Number(r.lost),
        conversionPct: total > 0 ? Math.round((won / total) * 100) : 0,
        totalValue: r.totalValue ?? 0,
      };
    }),
    estimatedExcluded: Number(excludedRow[0]?.n ?? 0),
  };
}
