import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getAccountWithApiKey } from "@/lib/asaas/account";
import { getMyAccountStatus } from "@/lib/asaas/kyc";

/**
 * GET /api/admin/account-status-live/[accountId]
 *
 * Sync ad-hoc — hit /myAccount/status do Asaas com a apiKey da subconta,
 * atualiza o mirror local e retorna a comparação DB vs Asaas. Owner-only.
 *
 * Útil pra confirmar se Asaas aprovou enquanto a UI cacheada ainda mostra
 * status antigo. Sem efeito colateral fora do mirror update.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { accountId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ACCOUNT_CREATE,
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

  const before = await prisma.asaasAccount.findFirst({
    where: { id: accountId, orgId: ctx.orgId },
    select: {
      id: true,
      asaasId: true,
      status: true,
      generalStatus: true,
      documentationStatus: true,
      commercialInfoStatus: true,
      bankAccountInfoStatus: true,
      approvedAt: true,
      lastStatusCheckAt: true,
    },
  });
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { apiKey } = await getAccountWithApiKey(before.id);
  const live = await getMyAccountStatus({ apiKey });

  const generalUp = live.general?.toUpperCase() ?? null;
  const newStatus =
    generalUp === "APPROVED"
      ? "APPROVED"
      : generalUp === "REJECTED"
        ? "REJECTED"
        : generalUp === "AWAITING_APPROVAL"
          ? "AWAITING_APPROVAL"
          : before.status;

  const updated = await prisma.asaasAccount.update({
    where: { id: before.id },
    data: {
      generalStatus: live.general ?? before.generalStatus,
      documentationStatus: live.documentation ?? before.documentationStatus,
      commercialInfoStatus: live.commercialInfo ?? before.commercialInfoStatus,
      bankAccountInfoStatus:
        live.bankAccountInfo ?? before.bankAccountInfoStatus,
      status: newStatus,
      lastStatusCheckAt: new Date(),
      approvedAt:
        generalUp === "APPROVED" && !before.approvedAt
          ? new Date()
          : before.approvedAt ?? undefined,
    },
    select: {
      status: true,
      generalStatus: true,
      documentationStatus: true,
      commercialInfoStatus: true,
      bankAccountInfoStatus: true,
      approvedAt: true,
      lastStatusCheckAt: true,
    },
  });

  return NextResponse.json({
    asaasId: before.asaasId,
    db_before: before,
    asaas_live: live,
    db_after: updated,
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
