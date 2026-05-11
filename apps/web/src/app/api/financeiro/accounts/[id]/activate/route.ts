import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  requireElevation,
  ElevationRequiredError,
} from "@/lib/security/elevation";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/financeiro/accounts/[id]/activate
 * Define a conta como ativa da org. Requer ACCOUNT_ACTIVATE + elevation BANK_ACCOUNT_SWITCH.
 *
 * Trocar conta ativa NÃO migra cobranças/transferências em aberto — elas
 * continuam na conta original (paymentId/walletId são per-conta no Asaas).
 * Apenas as próximas cobranças passam a usar a nova conta como default.
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
      permission: PERMISSION.ACCOUNT_ACTIVATE,
    });
    await requireElevation(ctx.userId, "BANK_ACCOUNT_SWITCH");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const account = await prisma.asaasAccount.findFirst({
    where: { id, orgId: ctx.orgId, archivedAt: null },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Conta não encontrada ou arquivada" },
      { status: 404 }
    );
  }
  if (account.status !== "APPROVED") {
    return NextResponse.json(
      {
        error: "Apenas contas APPROVED podem ser ativadas",
        accountStatus: account.status,
      },
      { status: 422 }
    );
  }

  const previous = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { activeAsaasAccountId: true },
  });

  await prisma.organization.update({
    where: { id: ctx.orgId },
    data: { activeAsaasAccountId: id },
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ACCOUNT_ACTIVATE",
      result: "SUCCESS",
      resourceType: "asaas_account",
      resource: `asaas_account:${id}`,
      metadata: {
        previousActiveAccountId: previous?.activeAsaasAccountId ?? null,
      },
    }
  );

  return NextResponse.json({ ok: true, activeAccountId: id });
}

export const runtime = "nodejs";
