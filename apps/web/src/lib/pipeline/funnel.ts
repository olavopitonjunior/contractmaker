import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { WON_STAGE_BY_KIND } from "./stage-config";
import {
  DEAL_SOURCE_CHANNEL_LABEL,
  type DealSourceChannel,
} from "./source-channel";

/**
 * Funil por canal de origem — o primeiro LEITOR de `Deal.sourceChannel`
 * (escrito em todos os 11 pontos de criação de deal desde 2026-07).
 *
 * Uma query agregada por kind. Critérios de desfecho:
 *   - perdido: `lostAt IS NOT NULL` (terminal alternativo das duas esteiras)
 *   - ganho (venda):   `commissionPaidAt IS NOT NULL` (terminal feliz)
 *   - ganho (locação): stage terminal feliz do kind (stage-config — fonte
 *     única dos nomes; o join de PipelineStage só entra nesse caso)
 *   - deals ARQUIVADOS ficam de fora (paridade com o kanban — arquivar é o
 *     jeito sancionado de tirar lixo/duplicata da frente sem deletar)
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

  // Predicado de "ganho" por kind, montado em TS — o WHERE já pina d.kind,
  // então um CASE por kind teria um braço permanentemente morto (e o join de
  // PipelineStage só é necessário em locação).
  const locacaoWonStage = WON_STAGE_BY_KIND.locacao; // "ADM"
  const wonPredicate =
    kind === "venda"
      ? Prisma.sql`d."commissionPaidAt" IS NOT NULL`
      : Prisma.sql`s.name = ${locacaoWonStage}`;
  const stageJoin =
    kind === "venda"
      ? Prisma.empty
      : Prisma.sql`JOIN "PipelineStage" s ON s.id = d."stageId"`;

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
      SUM(CASE WHEN ${wonPredicate} THEN 1 ELSE 0 END)::bigint AS won,
      SUM(CASE WHEN d."lostAt" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS lost,
      SUM(COALESCE(d.value, 0))::float8 AS "totalValue"
    FROM "Deal" d
    JOIN "Pipeline" p ON p.id = d."pipelineId"
    ${stageJoin}
    WHERE p."orgId" = ${orgId}
      AND d.kind = ${kind}
      AND d."archivedAt" IS NULL
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
