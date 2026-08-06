import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  AGING_WARN_DAYS,
  AGING_DANGER_DAYS,
  isTerminalStageName,
} from "@/lib/pipeline/stage-config";

/**
 * Resolução da política de SLA por stage (plano 2026-08-06, PR 3.3): linha da
 * org em `SlaPolicy { scope: "deal_stage", key: stageId }` SOBREPÕE os defaults
 * de código (AGING_WARN_DAYS/AGING_DANGER_DAYS); stages terminais nunca têm
 * SLA. Server-only (Prisma runtime) — a parte pura/client-safe vive em sla.ts.
 *
 * Consumidores: /settings/sla (PR 3.5) lista e edita; `recomputeSlaDeadlines`
 * re-materializa os deadlines após mudança de política. O moveDealStage NÃO
 * usa isto (ele congela a política na entrada via frozenPolicyFor — mesma
 * semântica, lookup pontual).
 */

export interface ResolvedSlaPolicy {
  stageId: string;
  stageName: string;
  position: number;
  terminal: boolean;
  /** null = stage sem SLA (terminal ou linha desabilitada). */
  warnDays: number | null;
  dangerDays: number | null;
  enabled: boolean;
  /** "custom" quando há linha da org; "default" = 5/10 de código. */
  source: "custom" | "default";
}

export async function resolveSlaPolicies(
  orgId: string,
  kind: "venda" | "locacao"
): Promise<ResolvedSlaPolicy[]> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId, kind },
    select: {
      stages: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, position: true },
      },
    },
  });
  if (!pipeline) return [];

  const rows = await prisma.slaPolicy.findMany({
    where: { orgId, scope: "deal_stage", kind },
    select: { key: true, warnDays: true, dangerDays: true, enabled: true },
  });
  const byStageId = new Map(rows.map((r) => [r.key, r]));

  return pipeline.stages.map((stage) => {
    const terminal = isTerminalStageName(stage.name);
    if (terminal) {
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position,
        terminal,
        warnDays: null,
        dangerDays: null,
        enabled: false,
        source: "default" as const,
      };
    }
    const row = byStageId.get(stage.id);
    if (row) {
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position,
        terminal,
        warnDays: row.enabled ? row.warnDays : null,
        dangerDays: row.enabled ? row.dangerDays : null,
        enabled: row.enabled,
        source: "custom" as const,
      };
    }
    return {
      stageId: stage.id,
      stageName: stage.name,
      position: stage.position,
      terminal,
      warnDays: AGING_WARN_DAYS,
      dangerDays: AGING_DANGER_DAYS,
      enabled: true,
      source: "default" as const,
    };
  });
}

/**
 * Re-materializa `Deal.slaWarnAt`/`slaDueAt` dos deals ATIVOS da esteira a
 * partir da política resolvida (chamado via waitUntil após PATCH em
 * /settings/sla — PR 3.5). Set-based por stage (uma org tem ~7 stages, não
 * itera deal a deal). Também atualiza a política congelada do intervalo
 * ABERTO no DealStageHistory — o intervalo corrente reflete a política nova;
 * intervalos fechados ficam como estavam (congelados de verdade).
 */
export async function recomputeSlaDeadlines(
  orgId: string,
  kind: "venda" | "locacao"
): Promise<{ stages: number }> {
  const policies = await resolveSlaPolicies(orgId, kind);

  for (const p of policies) {
    const hasSla = !p.terminal && p.enabled && p.warnDays != null && p.dangerDays != null;
    if (hasSla) {
      await prisma.$executeRaw`
        UPDATE "Deal"
        SET
          "slaWarnAt" = COALESCE("stageEnteredAt", "createdAt") + make_interval(days => ${p.warnDays}),
          "slaDueAt"  = COALESCE("stageEnteredAt", "createdAt") + make_interval(days => ${p.dangerDays})
        WHERE "stageId" = ${p.stageId}
          AND "archivedAt" IS NULL
          AND "lostAt" IS NULL`;
    } else {
      await prisma.deal.updateMany({
        where: { stageId: p.stageId, archivedAt: null, lostAt: null },
        data: { slaWarnAt: null, slaDueAt: null } satisfies Prisma.DealUncheckedUpdateManyInput,
      });
    }
    await prisma.dealStageHistory.updateMany({
      where: { orgId, stageId: p.stageId, exitedAt: null },
      data: {
        slaWarnDays: hasSla ? p.warnDays : null,
        slaDangerDays: hasSla ? p.dangerDays : null,
      },
    });
  }

  return { stages: policies.length };
}
