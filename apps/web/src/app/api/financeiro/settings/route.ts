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
import { resolveAsaasAccount } from "@/lib/asaas/account";

const discountPresetSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(60),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.number().positive(),
  dueDayOffset: z.number().int().max(0),
});

const patchSchema = z.object({
  accountId: z.string().optional(),
  platformFeePercent: z.number().min(0).max(10).optional(),
  platformFeeWalletId: z.string().trim().min(1).max(200).nullable().optional(),
  overpricePolicy: z.enum(["none", "absorb", "asaas_fee", "custom"]).optional(),
  overpriceType: z.enum(["percentage", "fixed"]).nullable().optional(),
  overpriceValue: z.number().nonnegative().nullable().optional(),
  overpriceRoundTo: z.enum(["cents", "real_up", "real_down"]).optional(),
  discountPresets: z.array(discountPresetSchema).optional(),
  finePercent: z.number().min(0).max(2).optional(),
  interestPercentMonth: z.number().min(0).max(1).optional(),
  asaasFeePixCents: z.number().int().min(0).optional(),
  asaasFeeBoletoCents: z.number().int().min(0).optional(),
  asaasFeeCardPercent: z.number().min(0).optional(),
  asaasFeeCardCents: z.number().int().min(0).optional(),
  defaultDueDays: z.number().int().min(1).max(90).optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  pixSplitFeePolicy: z.enum(["org_absorbs", "deduct_from_recipient"]).optional(),
});

async function getOrCreate(orgId: string, accountId: string) {
  let s = await prisma.orgFinancialSettings.findUnique({
    where: { accountId },
  });
  if (!s)
    s = await prisma.orgFinancialSettings.create({
      data: { orgId, accountId },
    });
  return s;
}

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
    return NextResponse.json({ settings: null, accountId: null });
  }
  const s = await getOrCreate(ctx.orgId, resolved.account.id);
  return NextResponse.json({ settings: s, accountId: resolved.account.id });
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.FEES_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
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

  const resolved = await resolveAsaasAccount({
    userId: ctx.userId,
    orgId: ctx.orgId,
    hintAccountId: parsed.data.accountId,
    requireCapability: "configure",
  });
  if (!resolved) {
    return NextResponse.json(
      { error: "Nenhuma conta Asaas configurável encontrada" },
      { status: 422 }
    );
  }

  const { accountId: _accId, ...patchData } = parsed.data;
  void _accId;
  await getOrCreate(ctx.orgId, resolved.account.id);
  const updated = await prisma.orgFinancialSettings.update({
    where: { accountId: resolved.account.id },
    data: patchData as any,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "FEES_UPDATED",
      result: "SUCCESS",
      resourceType: "org_financial_settings",
      resource: `org_financial_settings:${updated.id}`,
      metadata: { ...patchData, accountId: resolved.account.id } as any,
    }
  );

  return NextResponse.json({ settings: updated, accountId: resolved.account.id });
}
