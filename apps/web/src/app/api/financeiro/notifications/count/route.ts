import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/financeiro/notifications/count
 * Retorna contadores de itens que precisam atenção do usuário logado:
 *  - Dual approvals pendentes (que ele pode aprovar — ou seja, não iniciadas por ele)
 *  - Cobranças vencidas (overdue)
 *  - Conciliações pendentes (se permission)
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  const role = membership?.role ?? "viewer";
  const canApprove = role === "owner" || role === "admin";

  const [dualApprovals, overdueCharges, pendingRecon] = await Promise.all([
    canApprove
      ? prisma.dualApproval.count({
          where: {
            orgId: ctx.orgId,
            status: "PENDING",
            initiatedBy: { not: ctx.userId },
            expiresAt: { gt: new Date() },
          },
        })
      : 0,
    prisma.commissionCharge.count({
      where: {
        orgId: ctx.orgId,
        status: "OVERDUE",
        ...(role === "sales" ? { deal: { userId: ctx.userId } } : {}),
      },
    }),
    canApprove || role === "finance"
      ? prisma.bankReconciliation.count({
          where: { orgId: ctx.orgId, status: "pending" },
        })
      : 0,
  ]);

  const total = dualApprovals + overdueCharges + pendingRecon;

  return NextResponse.json({
    total,
    dualApprovals,
    overdueCharges,
    pendingReconciliation: pendingRecon,
  });
}
