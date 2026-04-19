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
import { audit } from "@/lib/security/audit";

const patchSchema = z.object({
  finePercent: z.number().min(0).max(2).optional(),
  interestPercentMonth: z.number().min(0).max(1).optional(),
  defaultDueDays: z.number().int().min(1).max(90).optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
});

async function getOrCreateSettings(orgId: string) {
  let settings = await prisma.orgFinancialSettings.findUnique({
    where: { orgId },
  });
  if (!settings) {
    settings = await prisma.orgFinancialSettings.create({
      data: { orgId },
    });
  }
  return settings;
}

/**
 * GET /api/settings/pagamentos — retorna defaults financeiros da org +
 * status da subconta Asaas.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const [settings, account] = await Promise.all([
    getOrCreateSettings(ctx.orgId),
    prisma.asaasAccount.findUnique({
      where: { orgId: ctx.orgId },
      select: {
        id: true,
        status: true,
        walletId: true,
        asaasId: true,
        personType: true,
        approvedAt: true,
        accountNumber: true,
      },
    }),
  ]);

  return NextResponse.json({
    settings: {
      finePercent: settings.finePercent,
      interestPercentMonth: settings.interestPercentMonth,
      defaultDueDays: settings.defaultDueDays,
      notifyEmail: settings.notifyEmail,
      notifySms: settings.notifySms,
      // Campos de overprice/platform fee/branding ficam para Fase 2
    },
    account: account
      ? {
          id: account.id,
          status: account.status,
          walletIdMasked: account.walletId
            ? account.walletId.slice(0, 8) + "***" + account.walletId.slice(-4)
            : null,
          personType: account.personType,
          accountNumber: account.accountNumber,
          approvedAt: account.approvedAt,
        }
      : null,
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

  await getOrCreateSettings(ctx.orgId);
  const settings = await prisma.orgFinancialSettings.update({
    where: { orgId: ctx.orgId },
    data: parsed.data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "FEES_UPDATED",
      result: "SUCCESS",
      resourceType: "org_financial_settings",
      resource: `org_financial_settings:${settings.id}`,
      metadata: parsed.data,
    }
  );

  return NextResponse.json({ settings });
}
