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
  status: z.enum(["pending", "matched", "ignored", "manual"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.RECONCILIATION_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Query inválida" }, { status: 400 });
  const q = parsed.data;

  const where: any = { orgId: ctx.orgId };
  if (q.status) where.status = q.status;
  if (q.from || q.to) {
    where.date = {};
    if (q.from) where.date.gte = new Date(q.from);
    if (q.to) where.date.lte = new Date(q.to);
  }

  const [total, rows, counts] = await Promise.all([
    prisma.bankReconciliation.count({ where }),
    prisma.bankReconciliation.findMany({
      where,
      orderBy: { date: "desc" },
      skip: q.offset,
      take: q.limit,
    }),
    prisma.bankReconciliation.groupBy({
      by: ["status"],
      where: { orgId: ctx.orgId },
      _count: true,
    }),
  ]);

  // Load matched charges
  const chargeIds = rows.map((r) => r.matchedChargeId).filter(Boolean) as string[];
  const charges = chargeIds.length
    ? await prisma.commissionCharge.findMany({
        where: { id: { in: chargeIds } },
        select: {
          id: true,
          asaasPaymentId: true,
          customer: { select: { name: true } },
        },
      })
    : [];
  const chargeMap = new Map(charges.map((c) => [c.id, c]));

  return NextResponse.json({
    total,
    offset: q.offset,
    limit: q.limit,
    counts: counts.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = c._count;
      return acc;
    }, {}),
    rows: rows.map((r) => ({
      ...r,
      matchedCharge: r.matchedChargeId ? chargeMap.get(r.matchedChargeId) : null,
    })),
  });
}
