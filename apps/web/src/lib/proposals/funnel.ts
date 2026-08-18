import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Funil de PROPOSTAS (plano 2026-08-06, PR 3.8) — a esteira pré-deal:
 * criação → envio (sentAt) → 1ª visualização (firstViewedAt) → assinatura do
 * proponente (ProposalEvent signed_proponente / acceptance_term_completed —
 * não há scalar; o evento é a fonte) → conversão em negócio (convertedDealId,
 * a PONTE pro pipeline). Tempos em PERCENTILE_CONT 0.5/0.9.
 *
 * SLA por STATUS: linhas `SlaPolicy { scope: "proposal_status", key: status }`
 * sobrepõem os defaults de código — mesma mecânica do deal_stage (PR 3.3/3.5),
 * chaves `enviada` (cobre enviada/entregue, âncora sentAt), `visualizada`
 * (âncora firstViewedAt) e `assinada_proponente` (âncora updatedAt — a
 * transição pro status é o último write; aproximação documentada).
 */

export interface ProposalFunnel {
  total: number;
  enviadas: number;
  visualizadas: number;
  assinadas: number;
  convertidas: number;
  /** Dias (1 casa) — null quando não há amostra. */
  medianCreateToSend: number | null;
  medianSendToView: number | null;
  medianViewToSign: number | null;
  medianSignToConvert: number | null;
  p90SendToView: number | null;
  p90ViewToSign: number | null;
}

const SIGNED_EVENTS = ["signed_proponente", "acceptance_term_completed"];

const secToDays = (sec: number | null) =>
  sec === null ? null : Math.round((sec / 86_400) * 10) / 10;

export async function getProposalFunnel(opts: {
  orgId: string;
  kind: "venda" | "locacao";
  from?: Date;
  to?: Date;
}): Promise<ProposalFunnel> {
  const { orgId, kind, from, to } = opts;
  const rows = await prisma.$queryRaw<
    Array<{
      total: bigint;
      enviadas: bigint;
      visualizadas: bigint;
      assinadas: bigint;
      convertidas: bigint;
      medCreateSend: number | null;
      medSendView: number | null;
      medViewSign: number | null;
      medSignConvert: number | null;
      p90SendView: number | null;
      p90ViewSign: number | null;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(p."sentAt")::bigint AS enviadas,
      COUNT(p."firstViewedAt")::bigint AS visualizadas,
      COUNT(sig."signedAt")::bigint AS assinadas,
      COUNT(p."convertedDealId")::bigint AS convertidas,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p."sentAt" - p."createdAt"))
      ) FILTER (WHERE p."sentAt" IS NOT NULL)::float8 AS "medCreateSend",
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p."firstViewedAt" - p."sentAt"))
      ) FILTER (
        WHERE p."sentAt" IS NOT NULL AND p."firstViewedAt" IS NOT NULL
      )::float8 AS "medSendView",
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (sig."signedAt" - p."firstViewedAt"))
      ) FILTER (
        WHERE p."firstViewedAt" IS NOT NULL AND sig."signedAt" IS NOT NULL
      )::float8 AS "medViewSign",
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p."convertedAt" - sig."signedAt"))
      ) FILTER (
        WHERE sig."signedAt" IS NOT NULL AND p."convertedAt" IS NOT NULL
      )::float8 AS "medSignConvert",
      PERCENTILE_CONT(0.9) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (p."firstViewedAt" - p."sentAt"))
      ) FILTER (
        WHERE p."sentAt" IS NOT NULL AND p."firstViewedAt" IS NOT NULL
      )::float8 AS "p90SendView",
      PERCENTILE_CONT(0.9) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (sig."signedAt" - p."firstViewedAt"))
      ) FILTER (
        WHERE p."firstViewedAt" IS NOT NULL AND sig."signedAt" IS NOT NULL
      )::float8 AS "p90ViewSign"
    FROM "Proposal" p
    LEFT JOIN LATERAL (
      SELECT MIN(e."createdAt") AS "signedAt"
      FROM "ProposalEvent" e
      WHERE e."proposalId" = p.id
        AND e."eventName" IN (${Prisma.join(SIGNED_EVENTS)})
    ) sig ON true
    WHERE p."orgId" = ${orgId}
      AND p.kind = ${kind}
      ${from ? Prisma.sql`AND p."createdAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND p."createdAt" < ${to}` : Prisma.empty}
  `);

  const r = rows[0];
  return {
    total: Number(r?.total ?? 0),
    enviadas: Number(r?.enviadas ?? 0),
    visualizadas: Number(r?.visualizadas ?? 0),
    assinadas: Number(r?.assinadas ?? 0),
    convertidas: Number(r?.convertidas ?? 0),
    medianCreateToSend: secToDays(r?.medCreateSend ?? null),
    medianSendToView: secToDays(r?.medSendView ?? null),
    medianViewToSign: secToDays(r?.medViewSign ?? null),
    medianSignToConvert: secToDays(r?.medSignConvert ?? null),
    p90SendToView: secToDays(r?.p90SendView ?? null),
    p90ViewToSign: secToDays(r?.p90ViewSign ?? null),
  };
}

// ── SLA por status da proposta ──────────────────────────────────────────────

export interface ProposalSlaPolicy {
  key: ProposalSlaKey;
  warnDays: number;
  dangerDays: number;
  enabled: boolean;
  source: "custom" | "default";
}

export const PROPOSAL_SLA_KEYS = [
  "enviada",
  "visualizada",
  "assinada_proponente",
] as const;
export type ProposalSlaKey = (typeof PROPOSAL_SLA_KEYS)[number];

/** Defaults de código — proposta parada é lead esfriando, régua mais curta
 *  que a de deal (5/10). */
export const PROPOSAL_SLA_DEFAULTS: Record<
  ProposalSlaKey,
  { warnDays: number; dangerDays: number }
> = {
  enviada: { warnDays: 3, dangerDays: 7 },
  visualizada: { warnDays: 3, dangerDays: 7 },
  assinada_proponente: { warnDays: 2, dangerDays: 5 },
};

export async function resolveProposalSlaPolicies(
  orgId: string
): Promise<ProposalSlaPolicy[]> {
  const rows = await prisma.slaPolicy.findMany({
    where: { orgId, scope: "proposal_status" },
    select: { key: true, warnDays: true, dangerDays: true, enabled: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return PROPOSAL_SLA_KEYS.map((key) => {
    const row = byKey.get(key);
    if (row) {
      return {
        key,
        warnDays: row.warnDays,
        dangerDays: row.dangerDays,
        enabled: row.enabled,
        source: "custom" as const,
      };
    }
    return { key, ...PROPOSAL_SLA_DEFAULTS[key], enabled: true, source: "default" as const };
  });
}

export interface StuckProposal {
  id: string;
  title: string;
  status: string;
  ageDays: number;
  slaStatus: "atencao" | "atrasado";
  /** Ponte pro pipeline — proposta convertida aponta pro Deal. */
  convertedDealId: string | null;
  responsibleLabel: string | null;
}

/**
 * Propostas PARADAS além da régua: status aguardando alguém, ancorado no
 * timestamp da transição correspondente. `enviada` cobre também `entregue`
 * (mesma espera: o proponente ainda não abriu).
 */
export async function getStuckProposals(opts: {
  orgId: string;
  kind: "venda" | "locacao";
  now?: Date;
  take?: number;
}): Promise<StuckProposal[]> {
  const { orgId, kind, now = new Date(), take = 20 } = opts;
  const policies = await resolveProposalSlaPolicies(orgId);
  const byKey = new Map(policies.map((p) => [p.key, p]));

  const proposals = await prisma.proposal.findMany({
    where: {
      orgId,
      kind,
      status: { in: ["enviada", "entregue", "visualizada", "assinada_proponente"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      sentAt: true,
      firstViewedAt: true,
      updatedAt: true,
      createdAt: true,
      convertedDealId: true,
      responsibleName: true,
      responsibleUser: { select: { name: true, email: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const out: StuckProposal[] = [];
  for (const p of proposals) {
    const key: ProposalSlaKey =
      p.status === "assinada_proponente"
        ? "assinada_proponente"
        : p.status === "visualizada"
          ? "visualizada"
          : "enviada";
    const policy = byKey.get(key);
    if (!policy || !policy.enabled) continue;
    const anchor =
      key === "enviada"
        ? (p.sentAt ?? p.createdAt)
        : key === "visualizada"
          ? (p.firstViewedAt ?? p.createdAt)
          : p.updatedAt;
    const ageDays = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
    if (ageDays < policy.warnDays) continue;
    out.push({
      id: p.id,
      title: p.title,
      status: p.status,
      ageDays,
      slaStatus: ageDays >= policy.dangerDays ? "atrasado" : "atencao",
      convertedDealId: p.convertedDealId,
      responsibleLabel:
        p.responsibleName ??
        p.responsibleUser?.name?.trim() ??
        p.responsibleUser?.email ??
        p.user?.name?.trim() ??
        p.user?.email ??
        null,
    });
  }

  return out
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, take);
}
