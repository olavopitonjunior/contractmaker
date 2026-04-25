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
import { retryFailedTransfer } from "@/lib/asaas/splitDispatcher";

/**
 * POST /api/financeiro/transfers/[id]/retry
 *
 * Re-executa um AsaasTransfer FAILED gerado por split-dispatch (Fase 6).
 * Não re-executa transferências manuais — se for manual, retorna 400.
 */
export async function POST(
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
      permission: PERMISSION.TRANSFER_INIT,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const transfer = await prisma.asaasTransfer.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!transfer) {
    return NextResponse.json({ error: "Transferência não encontrada" }, { status: 404 });
  }
  if (transfer.origin !== "split_dispatch") {
    return NextResponse.json(
      { error: "Apenas transferências de split podem ser re-executadas por este endpoint" },
      { status: 400 }
    );
  }

  const result = await retryFailedTransfer(id);

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: result.ok ? "TRANSFER_RETRY_SUCCESS" : "TRANSFER_RETRY_FAILED",
      result: result.ok ? "SUCCESS" : "FAILURE",
      resourceType: "asaas_transfer",
      resource: `asaas_transfer:${id}`,
      metadata: { reason: result.reason ?? null },
    }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: "RETRY_FAILED", reason: result.reason },
      { status: 422 }
    );
  }

  const refreshed = await prisma.asaasTransfer.findUnique({ where: { id } });
  return NextResponse.json({ transfer: refreshed });
}
