import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { maskPii } from "@/lib/security/pii";

/**
 * GET /api/financeiro/dual-approvals
 * Lista approvals. Default: PENDING da org atual.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDING";

  const approvals = await prisma.dualApproval.findMany({
    where: { orgId: ctx.orgId, status },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      initiator: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({
    approvals: approvals.map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      amount: a.amount,
      reason: a.reason ? maskPii(a.reason) : null,
      initiator: a.initiator,
      approver: a.approver,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
      resolvedAt: a.resolvedAt,
      executedAt: a.executedAt,
    })),
  });
}
