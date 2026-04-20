import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/financeiro/reconciliation/[id]/match/[chargeId]
 * Marca lançamento como conciliado manualmente com uma charge específica.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id, chargeId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.RECONCILIATION_MATCH,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const [recon, charge] = await Promise.all([
    prisma.bankReconciliation.findFirst({ where: { id, orgId: ctx.orgId } }),
    prisma.commissionCharge.findFirst({
      where: { id: chargeId, orgId: ctx.orgId },
      select: { id: true, value: true },
    }),
  ]);
  if (!recon) return NextResponse.json({ error: "Recon não encontrada" }, { status: 404 });
  if (!charge) return NextResponse.json({ error: "Charge não encontrada" }, { status: 404 });

  const updated = await prisma.bankReconciliation.update({
    where: { id: recon.id },
    data: {
      matchedChargeId: charge.id,
      status: "manual",
      matchedAt: new Date(),
      matchedBy: ctx.userId,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "CHARGE_EDIT",
      result: "SUCCESS",
      resourceType: "bank_reconciliation",
      resource: `bank_reconciliation:${recon.id}`,
      metadata: { chargeId: charge.id, mode: "manual" },
    }
  );

  return NextResponse.json({ reconciliation: updated });
}
