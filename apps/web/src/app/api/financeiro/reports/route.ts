import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/financeiro/reports?type=receivables|aging|cashflow|defaulters
 * Retorna dados agregados para dashboards. Uma rota única serve 4 tipos.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const type = new URL(req.url).searchParams.get("type") ?? "receivables";
  const now = new Date();

  if (type === "receivables") {
    const byStatus = await prisma.commissionCharge.groupBy({
      by: ["status"],
      where: { orgId: ctx.orgId },
      _sum: { value: true },
      _count: true,
    });
    const summary = byStatus.map((r) => ({
      status: r.status,
      value: r._sum.value ?? 0,
      count: r._count,
    }));
    return NextResponse.json({ type, summary });
  }

  if (type === "aging") {
    // Cobranças vencidas agrupadas em buckets
    const overdue = await prisma.commissionCharge.findMany({
      where: { orgId: ctx.orgId, status: "OVERDUE" },
      select: {
        id: true,
        value: true,
        currentDueDate: true,
        customer: { select: { name: true } },
      },
    });
    const buckets: Record<string, { count: number; value: number; charges: any[] }> = {
      "0-15": { count: 0, value: 0, charges: [] },
      "16-30": { count: 0, value: 0, charges: [] },
      "31-60": { count: 0, value: 0, charges: [] },
      "61-90": { count: 0, value: 0, charges: [] },
      "90+": { count: 0, value: 0, charges: [] },
    };
    for (const c of overdue) {
      const days = Math.floor(
        (now.getTime() - c.currentDueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const bucket =
        days <= 15 ? "0-15" : days <= 30 ? "16-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      buckets[bucket].count += 1;
      buckets[bucket].value += c.value;
      if (buckets[bucket].charges.length < 10) {
        buckets[bucket].charges.push({
          id: c.id,
          value: c.value,
          days,
          customer: c.customer?.name ?? null,
        });
      }
    }
    return NextResponse.json({
      type,
      totalOverdue: overdue.reduce((sum, c) => sum + c.value, 0),
      totalCount: overdue.length,
      buckets,
    });
  }

  if (type === "cashflow") {
    // Últimos 6 meses — recebido vs previsto
    const months: { key: string; label: string; received: number; expected: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        received: 0,
        expected: 0,
      });
    }

    const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [receivedBulk, expectedBulk] = await Promise.all([
      prisma.commissionCharge.findMany({
        where: {
          orgId: ctx.orgId,
          status: { in: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] },
          paidAt: { gte: startDate },
        },
        select: { value: true, paidAt: true },
      }),
      prisma.commissionCharge.findMany({
        where: {
          orgId: ctx.orgId,
          currentDueDate: { gte: startDate },
        },
        select: { value: true, currentDueDate: true },
      }),
    ]);

    for (const r of receivedBulk) {
      if (!r.paidAt) continue;
      const key = `${r.paidAt.getFullYear()}-${String(r.paidAt.getMonth() + 1).padStart(2, "0")}`;
      const b = months.find((m) => m.key === key);
      if (b) b.received += r.value;
    }
    for (const r of expectedBulk) {
      const key = `${r.currentDueDate.getFullYear()}-${String(r.currentDueDate.getMonth() + 1).padStart(2, "0")}`;
      const b = months.find((m) => m.key === key);
      if (b) b.expected += r.value;
    }

    return NextResponse.json({ type, months });
  }

  if (type === "defaulters") {
    // Top 10 clientes com valor vencido
    const overdue = await prisma.commissionCharge.groupBy({
      by: ["asaasCustomerId"],
      where: { orgId: ctx.orgId, status: "OVERDUE" },
      _sum: { value: true },
      _count: true,
      orderBy: { _sum: { value: "desc" } },
      take: 10,
    });
    const customerIds = overdue.map((o) => o.asaasCustomerId);
    const customers = await prisma.asaasCustomer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, cpfCnpj: true, email: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return NextResponse.json({
      type,
      defaulters: overdue.map((o) => ({
        customer: customerMap.get(o.asaasCustomerId) ?? null,
        overdueValue: o._sum.value ?? 0,
        overdueCount: o._count,
      })),
    });
  }

  return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
}
