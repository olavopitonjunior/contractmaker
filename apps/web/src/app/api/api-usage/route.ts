import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/api-usage?from=YYYY-MM-DD&to=YYYY-MM-DD&tokenId=X
 *
 * Agregados de Newton API por org. Session-only (admin/owner típico).
 * Retorna KPIs, daily breakdown, top endpoints/tokens, erros recentes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const tokenIdParam = url.searchParams.get("tokenId");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  const where: {
    orgId: string;
    createdAt: { gte: Date; lte: Date };
    tokenId?: string;
  } = {
    orgId: org.id,
    createdAt: { gte: from, lte: to },
  };
  if (tokenIdParam) where.tokenId = tokenIdParam;

  const [allRows, recentErrors, tokens] = await Promise.all([
    prisma.apiUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5000, // hard cap pra evitar OOM
      select: {
        id: true,
        userId: true,
        tokenId: true,
        via: true,
        method: true,
        path: true,
        statusCode: true,
        latencyMs: true,
        errorCode: true,
        createdAt: true,
      },
    }),
    prisma.apiUsage.findMany({
      where: { ...where, errorCode: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        method: true,
        path: true,
        statusCode: true,
        errorCode: true,
        createdAt: true,
      },
    }),
    prisma.userApiToken.findMany({
      where: { user: { orgMemberships: { some: { orgId: org.id } } } },
      select: { id: true, name: true },
    }),
  ]);

  // KPIs
  const total = allRows.length;
  const errors = allRows.filter((r) => r.statusCode >= 400).length;
  const errorRate = total > 0 ? errors / total : 0;
  const sortedLatency = [...allRows].sort((a, b) => a.latencyMs - b.latencyMs);
  const p50 = sortedLatency[Math.floor(sortedLatency.length * 0.5)]?.latencyMs ?? 0;
  const p95 = sortedLatency[Math.floor(sortedLatency.length * 0.95)]?.latencyMs ?? 0;

  // Daily breakdown
  const byDay = new Map<string, { calls: number; errors: number }>();
  for (const r of allRows) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { calls: 0, errors: 0 };
    bucket.calls += 1;
    if (r.statusCode >= 400) bucket.errors += 1;
    byDay.set(day, bucket);
  }
  const days = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ day, ...d }));

  // Top endpoints
  const byPath = new Map<string, { calls: number; latencySum: number }>();
  for (const r of allRows) {
    const key = `${r.method} ${r.path}`;
    const bucket = byPath.get(key) ?? { calls: 0, latencySum: 0 };
    bucket.calls += 1;
    bucket.latencySum += r.latencyMs;
    byPath.set(key, bucket);
  }
  const topEndpoints = Array.from(byPath.entries())
    .map(([key, d]) => ({
      endpoint: key,
      calls: d.calls,
      avgLatency: Math.round(d.latencySum / d.calls),
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  // Top tokens
  const byToken = new Map<string, { calls: number }>();
  for (const r of allRows) {
    if (!r.tokenId) continue;
    const bucket = byToken.get(r.tokenId) ?? { calls: 0 };
    bucket.calls += 1;
    byToken.set(r.tokenId, bucket);
  }
  const topTokens = Array.from(byToken.entries())
    .map(([tokenId, d]) => ({
      tokenId,
      tokenName: tokens.find((t) => t.id === tokenId)?.name ?? "(revogado)",
      calls: d.calls,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      calls: total,
      errors,
      errorRate,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
    },
    days,
    topEndpoints,
    topTokens,
    recentErrors,
    tokens,
  });
}
