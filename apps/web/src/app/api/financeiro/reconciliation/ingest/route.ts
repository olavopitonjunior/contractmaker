import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ingestFinancialTransactions } from "@/lib/asaas/reconciliation";
import { AsaasError } from "@/lib/asaas/errors";
import {
  getAccountWithApiKey,
  resolveAsaasAccount,
} from "@/lib/asaas/account";

const bodySchema = z.object({
  accountId: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  finishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: parsed.data.accountId,
    requireCapability: "view",
  });
  if (!resolved || resolved.account.status !== "APPROVED") {
    return NextResponse.json({ error: "Conta Asaas não aprovada" }, { status: 422 });
  }
  const account = resolved.account;
  const { apiKey } = await getAccountWithApiKey(account.id);

  try {
    const result = await ingestFinancialTransactions({
      orgId: ctx.orgId,
      accountId: account.id,
      apiKey,
      startDate: parsed.data.startDate,
      finishDate: parsed.data.finishDate,
    });
    return NextResponse.json({ accountId: account.id, ...result });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json({ error: "ASAAS_ERROR", details: err.errors }, { status: 422 });
    }
    throw err;
  }
}
