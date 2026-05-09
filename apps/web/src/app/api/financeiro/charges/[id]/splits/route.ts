import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * GET /api/financeiro/charges/[id]/splits
 *
 * Retorna o estado dos splits de uma cobrança:
 *  - asaasSplits — splits enviados pra Asaas (instantâneos, sem rastreamento)
 *  - externalSplits — entries PIX cadastradas; para cada uma, a transferência
 *    Asaas (se já criada) com status atual.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const charge = await prisma.commissionCharge.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, splitJson: true },
  });
  if (!charge) {
    return NextResponse.json({ error: "Cobrança não encontrada" }, { status: 404 });
  }

  const splitJson = (charge.splitJson ?? null) as
    | {
        splits?: unknown[];
        external?: unknown[];
        display?: { hiddenRecipientIds?: string[]; consolidationMap?: Record<string, string> };
      }
    | null;

  const transfers = await prisma.asaasTransfer.findMany({
    where: { commissionChargeId: id, orgId: ctx.orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      splitRecipientId: true,
      asaasTransferId: true,
      status: true,
      value: true,
      netValue: true,
      transferFee: true,
      pixAddressKey: true,
      pixKeyType: true,
      ownerName: true,
      effectiveDate: true,
      failureReason: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    asaasSplits: splitJson?.splits ?? [],
    externalSplits: splitJson?.external ?? [],
    display: splitJson?.display ?? null,
    transfers,
  });
}
