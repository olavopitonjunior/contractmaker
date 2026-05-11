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

const brandingSchema = z.object({
  accountId: z.string().optional(),
  brandLogoUrl: z.string().url().nullable().optional(),
  brandPrimaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor hex inválida (ex: #0f172a)")
    .optional(),
  brandDisplayName: z.string().max(120).nullable().optional(),
  brandSupportEmail: z.string().email().nullable().optional().or(z.literal("")),
  brandSupportPhone: z.string().max(30).nullable().optional(),
});

function contrastRatio(hex: string): number {
  // WCAG relative luminance — compara contra branco
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const whiteL = 1;
  return (Math.max(L, whiteL) + 0.05) / (Math.min(L, whiteL) + 0.05);
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.FEES_BRANDING_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = brandingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  if (parsed.data.brandPrimaryColor) {
    const ratio = contrastRatio(parsed.data.brandPrimaryColor);
    if (ratio < 4.5) {
      return NextResponse.json(
        {
          error: "COLOR_CONTRAST_TOO_LOW",
          message: `Cor com contraste insuficiente (ratio=${ratio.toFixed(2)}). Mínimo WCAG AA: 4.5`,
        },
        { status: 422 }
      );
    }
  }

  // Normalize empty strings to null
  const { accountId: _accId, ...dataRest } = parsed.data;
  void _accId;
  const data: any = { ...dataRest };
  if (data.brandSupportEmail === "") data.brandSupportEmail = null;

  // Resolve a conta cuja branding será editada (per-account)
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
  const accountId = resolved.account.id;

  let existing = await prisma.orgFinancialSettings.findUnique({
    where: { accountId },
  });
  if (!existing) {
    existing = await prisma.orgFinancialSettings.create({
      data: { orgId: ctx.orgId, accountId },
    });
  }
  const updated = await prisma.orgFinancialSettings.update({
    where: { accountId },
    data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "BRANDING_UPDATED",
      result: "SUCCESS",
      resourceType: "org_financial_settings",
      resource: `org_financial_settings:${updated.id}`,
      metadata: data,
    }
  );

  return NextResponse.json({ settings: updated });
}
