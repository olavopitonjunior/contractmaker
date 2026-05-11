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
import { cancelTransfer } from "@/lib/asaas/transfers";
import { AsaasError } from "@/lib/asaas/errors";
import { getAccountWithApiKey } from "@/lib/asaas/account";

/**
 * DELETE /api/financeiro/transfers/[id] — cancela transfer PENDING.
 * Resolve a conta via transfer.accountId (multi-account).
 */
export async function DELETE(
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
      permission: PERMISSION.TRANSFER_CANCEL_PENDING,
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
  if (!transfer) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (transfer.status !== "PENDING") {
    return NextResponse.json(
      { error: "Apenas transferências PENDING podem ser canceladas" },
      { status: 422 }
    );
  }

  // Conta resolvida via transfer.accountId (persistido na criação). Fallback
  // pra primeira conta da org pra transfers legados.
  let resolvedAccountId = transfer.accountId;
  if (!resolvedAccountId) {
    const fallback = await prisma.asaasAccount.findFirst({
      where: { orgId: ctx.orgId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      return NextResponse.json({ error: "Conta Asaas inválida" }, { status: 422 });
    }
    resolvedAccountId = fallback.id;
  }
  const { apiKey } = await getAccountWithApiKey(resolvedAccountId);

  if (!transfer.asaasTransferId) {
    return NextResponse.json(
      { error: "Transferência ainda não foi enviada ao Asaas — nada a cancelar" },
      { status: 400 }
    );
  }

  try {
    await cancelTransfer({ asaasId: transfer.asaasTransferId, apiKey });
    const updated = await prisma.asaasTransfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED" },
    });
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "TRANSFER_CANCEL",
        result: "SUCCESS",
        resourceType: "asaas_transfer",
        resource: `asaas_transfer:${transfer.id}`,
      }
    );
    return NextResponse.json({ transfer: updated });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json({ error: "ASAAS_ERROR", details: err.errors }, { status: 422 });
    }
    throw err;
  }
}
