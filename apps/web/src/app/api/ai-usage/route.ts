import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { agentLabel } from "@/lib/ai/agents/store";

/**
 * GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns aggregated AI usage for the authenticated user's org, scoped to the
 * requested date range (defaults to last 30 days). Used by the dashboard at
 * /settings/ai-usage.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to")
    ? new Date(searchParams.get("to")!)
    : new Date();
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Guard against invalid dates
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const where = {
    orgId: org.id,
    createdAt: { gte: from, lte: to },
  };

  // Fetch everything in parallel
  const [allRows, modelStats, opStats, providerStats, agentStats, errorRows] =
    await Promise.all([
      // 1. All rows to compute totals + per-day aggregation in memory (simpler than DATE_TRUNC in Prisma raw)
      prisma.aIUsage.findMany({
        where,
        select: {
          id: true,
          provider: true,
          model: true,
          operation: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          estimatedCostUsd: true,
          latencyMs: true,
          success: true,
          createdAt: true,
          userId: true,
          contractId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5000,
      }),
      // 2. Group by model
      prisma.aIUsage.groupBy({
        by: ["model", "provider"],
        where,
        _sum: {
          estimatedCostUsd: true,
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
        },
        _count: { _all: true },
        _avg: { latencyMs: true },
      }),
      // 3. Group by operation
      prisma.aIUsage.groupBy({
        by: ["operation"],
        where,
        _sum: { estimatedCostUsd: true, totalTokens: true },
        _count: { _all: true },
      }),
      // 4. Group by provider
      prisma.aIUsage.groupBy({
        by: ["provider"],
        where,
        _sum: { estimatedCostUsd: true, totalTokens: true },
        _count: { _all: true },
      }),
      // 5. Custo por AGENTE — a pergunta que o console de agentes cria e que
      //    o painel não sabia responder ("quanto custa o Editor?").
      prisma.aIUsage.groupBy({
        by: ["agentKey"],
        where,
        _sum: { estimatedCostUsd: true, totalTokens: true },
        _count: { _all: true },
      }),
      // 6. Recent errors
      prisma.aIUsage.findMany({
        where: { ...where, success: false },
        select: {
          id: true,
          model: true,
          provider: true,
          operation: true,
          errorMessage: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

  // Totals
  const totalCalls = allRows.length;
  const totalCost = allRows.reduce(
    (acc, r) => acc + Number(r.estimatedCostUsd ?? 0),
    0
  );
  const totalPromptTokens = allRows.reduce((acc, r) => acc + r.promptTokens, 0);
  const totalCompletionTokens = allRows.reduce(
    (acc, r) => acc + r.completionTokens,
    0
  );
  const totalCacheReadTokens = allRows.reduce(
    (acc, r) => acc + (r.cacheReadTokens ?? 0),
    0
  );
  const failures = allRows.filter((r) => !r.success).length;
  const errorRate = totalCalls > 0 ? failures / totalCalls : 0;
  const avgLatencyMs =
    totalCalls > 0
      ? Math.round(allRows.reduce((a, r) => a + r.latencyMs, 0) / totalCalls)
      : 0;

  // Aggregate by day (YYYY-MM-DD)
  const byDayMap = new Map<
    string,
    { date: string; costUsd: number; calls: number; tokens: number }
  >();
  for (const r of allRows) {
    const date = r.createdAt.toISOString().slice(0, 10);
    const entry = byDayMap.get(date) ?? {
      date,
      costUsd: 0,
      calls: 0,
      tokens: 0,
    };
    entry.costUsd += Number(r.estimatedCostUsd ?? 0);
    entry.calls += 1;
    entry.tokens += r.totalTokens;
    byDayMap.set(date, entry);
  }
  const byDay = Array.from(byDayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Top users
  const byUserMap = new Map<
    string,
    { userId: string; costUsd: number; calls: number }
  >();
  for (const r of allRows) {
    if (!r.userId) continue;
    const entry = byUserMap.get(r.userId) ?? {
      userId: r.userId,
      costUsd: 0,
      calls: 0,
    };
    entry.costUsd += Number(r.estimatedCostUsd ?? 0);
    entry.calls += 1;
    byUserMap.set(r.userId, entry);
  }
  const topUsersIds = Array.from(byUserMap.values())
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);
  const users = await prisma.user.findMany({
    where: { id: { in: topUsersIds.map((u) => u.userId) } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const byUser = topUsersIds.map((u) => ({
    userId: u.userId,
    name: userById.get(u.userId)?.name || null,
    email: userById.get(u.userId)?.email || null,
    costUsd: u.costUsd,
    calls: u.calls,
  }));

  // Top contracts
  const byContractMap = new Map<
    string,
    { contractId: string; costUsd: number; calls: number }
  >();
  for (const r of allRows) {
    if (!r.contractId) continue;
    const entry = byContractMap.get(r.contractId) ?? {
      contractId: r.contractId,
      costUsd: 0,
      calls: 0,
    };
    entry.costUsd += Number(r.estimatedCostUsd ?? 0);
    entry.calls += 1;
    byContractMap.set(r.contractId, entry);
  }
  const topContractIds = Array.from(byContractMap.values())
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);
  const contracts = await prisma.contract.findMany({
    where: { id: { in: topContractIds.map((c) => c.contractId) } },
    select: { id: true, dealId: true, deal: { select: { title: true } } },
  });
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const byContract = topContractIds.map((c) => ({
    contractId: c.contractId,
    title: contractById.get(c.contractId)?.deal?.title || "(sem título)",
    dealId: contractById.get(c.contractId)?.dealId || null,
    costUsd: c.costUsd,
    calls: c.calls,
  }));

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      costUsd: Number(totalCost.toFixed(4)),
      calls: totalCalls,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheReadTokens: totalCacheReadTokens,
      avgLatencyMs,
      errorRate: Number(errorRate.toFixed(4)),
      failures,
    },
    byDay,
    byModel: modelStats
      .map((m) => ({
        model: m.model,
        provider: m.provider,
        costUsd: Number((Number(m._sum.estimatedCostUsd ?? 0)).toFixed(4)),
        calls: m._count._all,
        totalTokens: m._sum.totalTokens ?? 0,
        promptTokens: m._sum.promptTokens ?? 0,
        completionTokens: m._sum.completionTokens ?? 0,
        avgLatencyMs: Math.round(m._avg.latencyMs ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byOperation: opStats
      .map((o) => ({
        operation: o.operation,
        costUsd: Number((Number(o._sum.estimatedCostUsd ?? 0)).toFixed(4)),
        calls: o._count._all,
        totalTokens: o._sum.totalTokens ?? 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byAgent: agentStats
      .map((a) => ({
        agentKey: a.agentKey,
        // `null` é honesto: o agregador do orquestrador não é um agente
        // configurável, e linha histórica anterior à coluna não tem dono.
        label: a.agentKey ? agentLabel(a.agentKey) : "Não atribuído",
        costUsd: Number((Number(a._sum.estimatedCostUsd ?? 0)).toFixed(4)),
        calls: a._count._all,
        totalTokens: a._sum.totalTokens ?? 0,
      }))
      .sort((x, y) => y.costUsd - x.costUsd),
    byProvider: providerStats
      .map((p) => ({
        provider: p.provider,
        costUsd: Number((Number(p._sum.estimatedCostUsd ?? 0)).toFixed(4)),
        calls: p._count._all,
        totalTokens: p._sum.totalTokens ?? 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byUser,
    byContract,
    recentErrors: errorRows.map((e) => ({
      id: e.id,
      model: e.model,
      provider: e.provider,
      operation: e.operation,
      errorMessage: e.errorMessage,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
