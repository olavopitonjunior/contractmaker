import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

const querySchema = z.object({
  accountId: z.string().optional(),
  status: z.string().optional(), // CSV: PENDING,CONFIRMED
  billingType: z.enum(["PIX", "BOLETO"]).optional(),
  search: z.string().optional(), // busca em customer.name ou description
  dealId: z.string().optional(),
  from: z.string().optional(), // YYYY-MM-DD (createdAt >= from)
  to: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/financeiro/charges — listagem global da org com filtros.
 * Sales só vê charges de próprios deals (scope lockdown).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req, { scope: "charges:r" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      // CHARGE_VIEW_ALL OR CHARGE_VIEW_OWN_DEALS_ONLY → filtrar depois
      permission: PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Query inválida" }, { status: 400 });
  }
  const q = parsed.data;

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });

  const where: any = { orgId: ctx.orgId };
  if (q.accountId) where.accountId = q.accountId;
  if (q.status) {
    const statuses = q.status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) where.status = { in: statuses };
  }
  if (q.billingType) where.billingType = q.billingType;
  if (q.dealId) where.dealId = q.dealId;
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to) where.createdAt.lte = new Date(q.to);
  }
  if (q.search) {
    where.OR = [
      { description: { contains: q.search, mode: "insensitive" } },
      { customer: { name: { contains: q.search, mode: "insensitive" } } },
      { customer: { cpfCnpj: { contains: q.search.replace(/\D/g, "") } } },
    ];
  }
  // Sales scope lockdown
  if (membership?.role === "sales") {
    where.deal = { userId: ctx.userId };
  }

  const [total, rows] = await Promise.all([
    prisma.commissionCharge.count({ where }),
    prisma.commissionCharge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: q.offset,
      take: q.limit,
      include: {
        customer: { select: { id: true, name: true, cpfCnpj: true, email: true } },
        deal: { select: { id: true, title: true } },
      },
    }),
  ]);

  // Status aggregations para chips da UI — também escopadas por accountId
  const byStatus = await prisma.commissionCharge.groupBy({
    by: ["status"],
    where: {
      orgId: ctx.orgId,
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(membership?.role === "sales" ? { deal: { userId: ctx.userId } } : {}),
    },
    _count: true,
  });

  return NextResponse.json({
    total,
    offset: q.offset,
    limit: q.limit,
    statusCounts: byStatus.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = r._count;
      return acc;
    }, {}),
    rows: rows.map((c) => ({
      id: c.id,
      asaasPaymentId: c.asaasPaymentId,
      value: c.value,
      netValue: c.netValue,
      billingType: c.billingType,
      kind: c.kind,
      status: c.status,
      asaasStatus: c.asaasStatus,
      description: c.description,
      currentDueDate: c.currentDueDate,
      paidAt: c.paidAt,
      cancelledAt: c.cancelledAt,
      refundedAt: c.refundedAt,
      customer: c.customer,
      deal: c.deal,
      createdAt: c.createdAt,
    })),
  });
}
