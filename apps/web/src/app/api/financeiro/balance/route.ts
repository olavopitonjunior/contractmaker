import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getBalance } from "@/lib/asaas/finance";
import { AsaasError } from "@/lib/asaas/errors";
import {
  getAccountWithApiKey,
  resolveAsaasAccount,
} from "@/lib/asaas/account";

export const dynamic = "force-dynamic";
export const revalidate = 30; // cache 30s

/**
 * GET /api/financeiro/balance?accountId=
 * Saldo atual da subconta. Sem accountId = conta ativa do user.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.FINANCE_BALANCE_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const accountIdHint = url.searchParams.get("accountId");
  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: accountIdHint,
    requireCapability: "view",
  });
  if (!resolved) {
    return NextResponse.json(
      { error: "Conta Asaas não configurada ou inacessível" },
      { status: 422 }
    );
  }
  const account = resolved.account;
  if (account.status !== "APPROVED") {
    return NextResponse.json({
      balance: null,
      accountId: account.id,
      accountStatus: account.status,
    });
  }

  const { apiKey } = await getAccountWithApiKey(account.id);

  try {
    const balance = await getBalance({ apiKey });
    return NextResponse.json({
      accountId: account.id,
      balance:
        balance.totalBalance ??
        balance.availableBalance ??
        balance.balance ??
        0,
      blockedBalance: balance.blockedBalance ?? 0,
      pendingBalance: balance.pendingBalance ?? 0,
      accountStatus: account.status,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors, balance: null },
        { status: 422 }
      );
    }
    console.error("[balance]", err);
    return NextResponse.json({ error: "Falha ao obter saldo", balance: null }, { status: 500 });
  }
}
