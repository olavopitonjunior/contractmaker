import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { pingAsaas } from "@/lib/asaas/client";
import { getMyAccountStatus } from "@/lib/asaas/kyc";
import { getAccountWithApiKey } from "@/lib/asaas/account";

/**
 * POST /api/settings/pagamentos/test
 *
 * Testa:
 *  1. Conectividade com Asaas (master key, via pingAsaas)
 *  2. Se a org tem subconta, testa apiKey da subconta + status KYC
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Master ping
  const masterPing = await pingAsaas();
  checks.push({
    name: "master_api_key",
    ok: masterPing.ok,
    detail: masterPing.ok ? `sandbox=${masterPing.env === "sandbox"}` : masterPing.error,
  });

  // 2. Subcontas (multi-account: testa cada conta não-arquivada da org)
  const url = new URL(req.url);
  const accountIdHint = url.searchParams.get("accountId");
  const accounts = accountIdHint
    ? await prisma.asaasAccount.findMany({
        where: { id: accountIdHint, orgId: ctx.orgId, archivedAt: null },
      })
    : await prisma.asaasAccount.findMany({
        where: { orgId: ctx.orgId, archivedAt: null },
      });
  for (const account of accounts) {
    const acctTag = account.label ? `:${account.label}` : `:${account.id.slice(0, 6)}`;
    try {
      const { apiKey } = await getAccountWithApiKey(account.id);
      const subPing = await pingAsaas(apiKey);
      checks.push({
        name: `subaccount_api_key${acctTag}`,
        ok: subPing.ok,
        detail: subPing.ok ? "ok" : subPing.error ?? "unknown",
      });

      if (subPing.ok) {
        try {
          const status = await getMyAccountStatus({ apiKey });
          checks.push({
            name: `subaccount_kyc_status${acctTag}`,
            ok: true,
            detail: `general=${status.general} docs=${status.documentation}`,
          });
        } catch (e) {
          checks.push({
            name: `subaccount_kyc_status${acctTag}`,
            ok: false,
            detail: e instanceof Error ? e.message : "unknown",
          });
        }
      }
    } catch (e) {
      checks.push({
        name: `subaccount_api_key${acctTag}`,
        ok: false,
        detail: e instanceof Error ? e.message : "decrypt failed",
      });
    }
  }

  // 3. Webhook config
  checks.push({
    name: "webhook_token_configured",
    ok: !!process.env.ASAAS_WEBHOOK_TOKEN,
    detail: process.env.ASAAS_WEBHOOK_TOKEN ? "ok" : "ASAAS_WEBHOOK_TOKEN ausente",
  });

  const allOk = checks.every((c) => c.ok);

  return NextResponse.json({
    ok: allOk,
    checks,
  });
}
