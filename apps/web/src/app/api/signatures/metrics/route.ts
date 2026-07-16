import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getMonthlySpendCents,
} from "@/lib/clicksign/executor";
import { getMonthlyBudgetCents } from "@/lib/clicksign/costs";
import { getSignatureSettings } from "@/lib/clicksign/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecentEnvelope {
  id: string;
  name: string;
  status: string;
  costCents: number;
  sentAt: string | null;
  closedAt: string | null;
  contractId: string | null;
  attachmentId: string | null;
  source: string;
  // Null em envelope de proposta — ela vive fora do kanban e só ganha deal na
  // conversão.
  dealId: string | null;
  signerCount: number;
}

interface RecentEvent {
  id: string;
  eventName: string;
  receivedAt: string;
  envelopeId: string;
  source: string;
}

interface MetricsResponse {
  range: { from: string; to: string };
  spendCents: number;
  spendMonthCents: number;
  budgetCents: number;
  totalEnvelopes: number;
  byStatus: Record<string, number>;
  closeRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  recentEnvelopes: RecentEnvelope[];
  recentEvents: RecentEvent[];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

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

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const where = {
    orgId: org.id,
    createdAt: { gte: from, lte: to },
  };

  const [envelopes, recentEvents, spendMonthCents] = await Promise.all([
    prisma.envelope.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { signers: true } },
      },
      take: 200,
    }),
    prisma.envelopeEvent.findMany({
      where: { envelope: { orgId: org.id } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    getMonthlySpendCents(org.id),
  ]);
  const sigSettings = await getSignatureSettings(org.id);

  const byStatus: Record<string, number> = {};
  let spendCents = 0;
  const latencies: number[] = [];
  for (const env of envelopes) {
    byStatus[env.status] = (byStatus[env.status] ?? 0) + 1;
    if (env.status === "running" || env.status === "closed") {
      spendCents += env.costCents;
    }
    if (env.sentAt && env.closedAt) {
      latencies.push(env.closedAt.getTime() - env.sentAt.getTime());
    }
  }
  const closed = byStatus.closed ?? 0;
  const denominator =
    (byStatus.closed ?? 0) +
    (byStatus.canceled ?? 0) +
    (byStatus.running ?? 0) +
    (byStatus.failed ?? 0);
  const closeRate = denominator > 0 ? closed / denominator : 0;

  const recentEnvelopes: RecentEnvelope[] = envelopes.slice(0, 50).map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    costCents: e.costCents,
    sentAt: e.sentAt ? e.sentAt.toISOString() : null,
    closedAt: e.closedAt ? e.closedAt.toISOString() : null,
    contractId: e.contractId,
    attachmentId: e.attachmentId,
    source: e.source,
    dealId: e.dealId,
    signerCount: e._count.signers,
  }));

  const recentEventsOut: RecentEvent[] = recentEvents.map((ev) => ({
    id: ev.id,
    eventName: ev.eventName,
    receivedAt: ev.receivedAt.toISOString(),
    envelopeId: ev.envelopeId,
    source: ev.source,
  }));

  const body: MetricsResponse = {
    range: { from: from.toISOString(), to: to.toISOString() },
    spendCents,
    spendMonthCents,
    budgetCents: getMonthlyBudgetCents(sigSettings.monthlyBudgetCents),
    totalEnvelopes: envelopes.length,
    byStatus,
    closeRate,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    recentEnvelopes,
    recentEvents: recentEventsOut,
  };

  return NextResponse.json(body);
}
