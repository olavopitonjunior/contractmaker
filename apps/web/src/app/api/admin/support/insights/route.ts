import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { getSupportConfig } from "@/lib/support/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Agregações de qualidade dos últimos 30 dias + fila de pendências.
export async function GET() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const config = await getSupportConfig();

  const [total, handoffs, up, down, lowConfidence, pendingCount, topPending, recentNegative] =
    await Promise.all([
      prisma.supportInteraction.count({ where: { createdAt: { gte: since } } }),
      prisma.supportInteraction.count({
        where: { createdAt: { gte: since }, handoffCreated: true },
      }),
      prisma.supportInteraction.count({ where: { createdAt: { gte: since }, rating: 1 } }),
      prisma.supportInteraction.count({ where: { createdAt: { gte: since }, rating: -1 } }),
      prisma.supportInteraction.count({
        where: {
          createdAt: { gte: since },
          kbTopSimilarity: { not: null, lt: config.handoffMinSimilarity },
        },
      }),
      prisma.supportHandoff.count({ where: { status: "pending" } }),
      prisma.supportHandoff.findMany({
        where: { status: "pending" },
        orderBy: { count: "desc" },
        take: 10,
        select: { id: true, question: true, count: true, screenPath: true },
      }),
      prisma.supportInteraction.findMany({
        where: { createdAt: { gte: since }, rating: -1 },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, question: true, screenPath: true, createdAt: true },
      }),
    ]);

  // Por tenant — era a única métrica do admin sem a linha por org: o blob
  // global dizia "há 12 handoffs" sem dizer DE QUEM, e suporte é exatamente
  // onde saber o tenant muda a ação.
  const [porOrg, orgs] = await Promise.all([
    prisma.supportInteraction.groupBy({
      by: ["orgId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.organization.findMany({ select: { id: true, name: true } }),
  ]);
  const [negPorOrg, handoffPorOrg] = await Promise.all([
    prisma.supportInteraction.groupBy({
      by: ["orgId"],
      where: { createdAt: { gte: since }, rating: -1 },
      _count: { _all: true },
    }),
    prisma.supportInteraction.groupBy({
      by: ["orgId"],
      where: { createdAt: { gte: since }, handoffCreated: true },
      _count: { _all: true },
    }),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const neg = new Map(negPorOrg.map((r) => [r.orgId, r._count._all]));
  const hand = new Map(handoffPorOrg.map((r) => [r.orgId, r._count._all]));
  const perTenant = porOrg
    .map((r) => ({
      orgId: r.orgId,
      name: orgName.get(r.orgId) ?? r.orgId,
      total: r._count._all,
      negatives: neg.get(r.orgId) ?? 0,
      handoffs: hand.get(r.orgId) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    windowDays: 30,
    kpis: {
      total,
      handoffs,
      up,
      down,
      lowConfidence,
      handoffRate: total ? Math.round((handoffs / total) * 100) : 0,
    },
    pendingCount,
    topPending,
    perTenant,
    recentNegative: recentNegative.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
