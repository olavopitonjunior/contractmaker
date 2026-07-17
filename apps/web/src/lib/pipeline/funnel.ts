import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  DEAL_SOURCE_CHANNEL_LABEL,
  type DealSourceChannel,
} from "./source-channel";

/**
 * Funil por canal de origem — o primeiro LEITOR de `Deal.sourceChannel`
 * (escrito em todos os 11 pontos de criação de deal desde 2026-07).
 *
 * Uma query agregada (join Pipeline pro escopo de org + PipelineStage pro
 * terminal de locação). Critérios de desfecho:
 *   - perdido: `lostAt IS NOT NULL` (terminal alternativo das duas esteiras)
 *   - ganho (venda):   `commissionPaidAt IS NOT NULL` (terminal feliz)
 *   - ganho (locação): stage atual "ADM" (contrato graduado pra administração)
 *
 * Deals anteriores à migration têm sourceChannel null → bucket
 * "Anterior ao rastreio" (dado honesto; sem backfill heurístico).
 */
export interface FunnelRow {
  channel: string | null;
  label: string;
  total: number;
  won: number;
  lost: number;
  /** Soma de Deal.value (R$) dos deals do canal. */
  totalValue: number;
  /** % ganho/total (0-100, arredondado). */
  conversionPct: number;
}

const NULL_CHANNEL_LABEL = "Anterior ao rastreio";

export async function getFunnelByChannel(opts: {
  orgId: string;
  kind: "venda" | "locacao";
  /** Janela pela criação do deal. Omitir = tudo. */
  from?: Date;
  to?: Date;
}): Promise<FunnelRow[]> {
  const { orgId, kind, from, to } = opts;

  const rows = await prisma.$queryRaw<
    Array<{
      sourceChannel: string | null;
      total: bigint;
      won: bigint;
      lost: bigint;
      totalValue: number | null;
    }>
  >(Prisma.sql`
    SELECT
      d."sourceChannel",
      COUNT(*)::bigint AS total,
      SUM(
        CASE
          WHEN d.kind = 'venda' AND d."commissionPaidAt" IS NOT NULL THEN 1
          WHEN d.kind = 'locacao' AND s.name = 'ADM' THEN 1
          ELSE 0
        END
      )::bigint AS won,
      SUM(CASE WHEN d."lostAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS lost,
      SUM(COALESCE(d.value, 0))::float8 AS "totalValue"
    FROM "Deal" d
    JOIN "Pipeline" p ON p.id = d."pipelineId"
    JOIN "PipelineStage" s ON s.id = d."stageId"
    WHERE p."orgId" = ${orgId}
      AND d.kind = ${kind}
      ${from ? Prisma.sql`AND d."createdAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND d."createdAt" < ${to}` : Prisma.empty}
    GROUP BY d."sourceChannel"
  `);

  return rows
    .map((r) => {
      const total = Number(r.total);
      const won = Number(r.won);
      return {
        channel: r.sourceChannel,
        label: r.sourceChannel
          ? DEAL_SOURCE_CHANNEL_LABEL[r.sourceChannel as DealSourceChannel] ??
            r.sourceChannel
          : NULL_CHANNEL_LABEL,
        total,
        won,
        lost: Number(r.lost),
        totalValue: r.totalValue ?? 0,
        conversionPct: total > 0 ? Math.round((won / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}
