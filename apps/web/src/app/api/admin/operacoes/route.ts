import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/operacoes?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Agregação de KPIs operacionais para o dashboard `/settings/operacoes`.
 * Escopado por orgId da sessão.
 */

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 401 });
  }
  const orgId = org.id;

  const url = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDate(url.searchParams.get("from"), defaultFrom);
  const to = parseDate(url.searchParams.get("to"), now);

  // 1. Webhooks
  const [
    webhookTotal,
    webhooksWithError,
    webhooksUnprocessed,
    lastWebhook,
    webhooksByEvent,
  ] = await Promise.all([
    prisma.asaasWebhookEvent.count({
      where: { orgId, receivedAt: { gte: from, lte: to } },
    }),
    prisma.asaasWebhookEvent.count({
      where: {
        orgId,
        receivedAt: { gte: from, lte: to },
        processingError: { not: null },
      },
    }),
    prisma.asaasWebhookEvent.count({
      where: {
        orgId,
        receivedAt: { gte: from, lte: to },
        processedAt: null,
      },
    }),
    prisma.asaasWebhookEvent.findFirst({
      where: { orgId },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true, event: true, processedAt: true },
    }),
    prisma.asaasWebhookEvent.groupBy({
      by: ["event"],
      where: { orgId, receivedAt: { gte: from, lte: to } },
      _count: true,
    }),
  ]);

  // Latência média de processamento (apenas eventos processados)
  const processedWebhooks = await prisma.asaasWebhookEvent.findMany({
    where: {
      orgId,
      receivedAt: { gte: from, lte: to },
      processedAt: { not: null },
    },
    select: { receivedAt: true, processedAt: true },
    take: 500,
  });
  const latencies = processedWebhooks
    .map((w) => (w.processedAt!.getTime() - w.receivedAt.getTime()))
    .filter((ms) => ms >= 0);
  const avgLatencyMs =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length);

  // Top 5 erros recentes
  const recentErrors = await prisma.asaasWebhookEvent.findMany({
    where: {
      orgId,
      receivedAt: { gte: from, lte: to },
      processingError: { not: null },
    },
    orderBy: { receivedAt: "desc" },
    take: 5,
    select: {
      asaasEventId: true,
      event: true,
      receivedAt: true,
      processingError: true,
    },
  });

  // 2. Transfers
  const [transfersByStatus, transfersByOrigin] = await Promise.all([
    prisma.asaasTransfer.groupBy({
      by: ["status"],
      where: { orgId, createdAt: { gte: from, lte: to } },
      _count: true,
    }),
    prisma.asaasTransfer.groupBy({
      by: ["origin"],
      where: { orgId, createdAt: { gte: from, lte: to } },
      _count: true,
    }),
  ]);

  // Splits FAILED com retry disponível
  const failedSplitsCount = await prisma.asaasTransfer.count({
    where: {
      orgId,
      status: "FAILED",
      origin: "split_dispatch",
      createdAt: { gte: from, lte: to },
    },
  });

  // 3. Cobranças
  const now2 = new Date();
  const [pendingCount, overdueCount, recentlyReceived] = await Promise.all([
    prisma.commissionCharge.count({
      where: { orgId, status: "PENDING", currentDueDate: { gte: now2 } },
    }),
    prisma.commissionCharge.count({
      where: {
        orgId,
        status: { in: ["PENDING", "OVERDUE"] },
        currentDueDate: { lt: now2 },
      },
    }),
    prisma.commissionCharge.count({
      where: {
        orgId,
        status: { in: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] },
        paidAt: { gte: from, lte: to },
      },
    }),
  ]);

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    webhooks: {
      total: webhookTotal,
      withError: webhooksWithError,
      unprocessed: webhooksUnprocessed,
      successRate:
        webhookTotal === 0
          ? null
          : Math.round(
              ((webhookTotal - webhooksWithError - webhooksUnprocessed) /
                webhookTotal) *
                100
            ),
      avgLatencyMs,
      byEvent: webhooksByEvent.map((w) => ({
        event: w.event,
        count: w._count,
      })),
      lastReceivedAt: lastWebhook?.receivedAt ?? null,
      recentErrors: recentErrors.map((e) => ({
        eventId: e.asaasEventId,
        event: e.event,
        receivedAt: e.receivedAt,
        error: (e.processingError ?? "").slice(0, 200),
      })),
    },
    transfers: {
      byStatus: transfersByStatus.map((t) => ({
        status: t.status,
        count: t._count,
      })),
      byOrigin: transfersByOrigin.map((t) => ({
        origin: t.origin,
        count: t._count,
      })),
      failedSplitsRetryable: failedSplitsCount,
    },
    charges: {
      pending: pendingCount,
      overdue: overdueCount,
      recentlyReceived,
    },
  });
}
