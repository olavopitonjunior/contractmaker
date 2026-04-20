import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/financeiro/dual-approvals/[id] — detalhe para página de aprovação.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const approval = await prisma.dualApproval.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      initiator: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
    },
  });
  if (!approval) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  return NextResponse.json({
    approval: {
      id: approval.id,
      kind: approval.kind,
      status: approval.status,
      amount: approval.amount,
      reason: approval.reason,
      payload: approval.payloadJson,
      initiator: approval.initiator,
      approver: approval.approver,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      resolvedAt: approval.resolvedAt,
      executedAt: approval.executedAt,
      canApprove:
        approval.status === "PENDING" &&
        approval.expiresAt > new Date() &&
        approval.initiatedBy !== ctx.userId,
    },
  });
}
