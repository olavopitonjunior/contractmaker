import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
  requireAccountCapability,
  AccountCapabilityDeniedError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  resolveAsaasAccount,
  maskWalletId,
} from "@/lib/asaas/account";

const patchSchema = z.object({
  /** Conta cuja settings serão editadas. Default: ativa do user. */
  accountId: z.string().optional(),
  finePercent: z.number().min(0).max(2).optional(),
  interestPercentMonth: z.number().min(0).max(1).optional(),
  defaultDueDays: z.number().int().min(1).max(90).optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
});

async function getOrCreateSettings(orgId: string, accountId: string) {
  let settings = await prisma.orgFinancialSettings.findUnique({
    where: { accountId },
  });
  if (!settings) {
    settings = await prisma.orgFinancialSettings.create({
      data: { orgId, accountId },
    });
  }
  return settings;
}

/**
 * GET /api/settings/pagamentos?accountId= — settings + status da conta selecionada.
 * Sem accountId, usa a conta ativa do user.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const accountIdHint = url.searchParams.get("accountId");
  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: accountIdHint,
    requireCapability: "view",
  });
  if (!resolved) {
    return NextResponse.json({
      settings: null,
      account: null,
      webhookUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/webhooks/asaas`,
      webhookConfigured: !!process.env.ASAAS_WEBHOOK_TOKEN,
    });
  }
  const account = resolved.account;
  const settings = await getOrCreateSettings(ctx.orgId, account.id);

  return NextResponse.json({
    settings: {
      finePercent: settings.finePercent,
      interestPercentMonth: settings.interestPercentMonth,
      defaultDueDays: settings.defaultDueDays,
      notifyEmail: settings.notifyEmail,
      notifySms: settings.notifySms,
      // Campos de overprice/platform fee/branding expostos por endpoints
      // específicos (per-account já no schema).
    },
    account: {
      id: account.id,
      label: account.label,
      status: account.status,
      walletIdMasked: maskWalletId(account.walletId),
      personType: account.personType,
      accountNumber: account.accountNumber,
      approvedAt: account.approvedAt,
    },
    webhookUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/webhooks/asaas`,
    webhookConfigured: !!process.env.ASAAS_WEBHOOK_TOKEN,
  });
}

/**
 * PATCH /api/settings/pagamentos
 */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
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

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Resolve a conta cuja settings serão editadas + valida cap "configure"
  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: parsed.data.accountId,
    requireCapability: "configure",
  });
  if (!resolved) {
    return NextResponse.json(
      { error: "Conta Asaas não encontrada ou sem capability `configure`" },
      { status: 422 }
    );
  }
  try {
    await requireAccountCapability({
      userId: ctx.userId,
      accountId: resolved.account.id,
      capability: "configure",
    });
  } catch (err) {
    if (err instanceof AccountCapabilityDeniedError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const { accountId: _ignore, ...patchData } = parsed.data;
  void _ignore;
  await getOrCreateSettings(ctx.orgId, resolved.account.id);
  const settings = await prisma.orgFinancialSettings.update({
    where: { accountId: resolved.account.id },
    data: patchData,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "FEES_UPDATED",
      result: "SUCCESS",
      resourceType: "org_financial_settings",
      resource: `org_financial_settings:${settings.id}`,
      metadata: { ...patchData, accountId: resolved.account.id },
    }
  );

  return NextResponse.json({ settings, accountId: resolved.account.id });
}
