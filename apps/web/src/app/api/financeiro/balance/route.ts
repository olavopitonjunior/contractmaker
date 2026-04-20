import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { decryptSecret } from "@/lib/security/crypto";
import { getBalance } from "@/lib/asaas/finance";
import { AsaasError } from "@/lib/asaas/errors";

export const dynamic = "force-dynamic";
export const revalidate = 30; // cache 30s

/**
 * GET /api/financeiro/balance — saldo atual da subconta.
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

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta Asaas não configurada" }, { status: 422 });
  }
  if (account.status !== "APPROVED") {
    return NextResponse.json({ balance: null, accountStatus: account.status });
  }

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    const balance = await getBalance({ apiKey });
    return NextResponse.json({
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
