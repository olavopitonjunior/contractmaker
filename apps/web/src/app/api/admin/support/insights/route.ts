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
    recentNegative: recentNegative.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
