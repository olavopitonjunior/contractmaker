import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgBrand } from "@/lib/tenant/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Identidade visual da imobiliária — fonte canônica (BrandingSettings, 1:1 com
 * a org). Substitui `/api/financeiro/settings/branding`, que gravava por conta
 * Asaas. Gate de org (ORG_SETTINGS_*), não de financeiro: a marca é da
 * imobiliária, não da conta de recebimento.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const Body = z.object({
  displayName: z.string().trim().max(120).optional(),
  supportEmail: z.string().trim().max(160).optional(),
  supportPhone: z.string().trim().max(40).optional(),
  logoUrl: z.string().trim().max(600).optional(),
  primaryColor: z.string().trim().max(9).optional(),
  secondaryColor: z.string().trim().max(9).optional(),
});

type PermissionValue = (typeof PERMISSION)[keyof typeof PERMISSION];

async function guard(
  ctx: { userId: string; orgId: string },
  permission: PermissionValue
) {
  // Impersonation-aware: sob "testar como", o super_admin age como o dono da org
  // (mesmo tratamento de /api/org/fiscal-settings).
  const effUserId = await getEffectiveUserId(ctx.userId);
  await requirePermission({ userId: effUserId, orgId: ctx.orgId, permission });
}

/** GET — a marca RESOLVIDA (com os defaults derivados), pronta pro formulário. */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await guard(ctx, PERMISSION.ORG_SETTINGS_READ);
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const [brand, row] = await Promise.all([
    getOrgBrand(ctx.orgId),
    prisma.brandingSettings.findUnique({
      where: { orgId: ctx.orgId },
      select: { secondaryColor: true },
    }),
  ]);

  // Devolve o valor resolvido: o dono abre a tela e encontra nome e contato já
  // preenchidos (derivados da org), em vez de campos vazios pra redigitar.
  return NextResponse.json({
    displayName: brand.displayName,
    supportEmail: brand.supportEmail ?? "",
    supportPhone: brand.supportPhone ?? "",
    logoUrl: brand.logoUrl ?? "",
    primaryColor: brand.primaryColor,
    secondaryColor: row?.secondaryColor ?? "",
  });
}

/** PATCH — grava só o que veio no corpo (o form manda apenas campos sujos). */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await guard(ctx, PERMISSION.ORG_SETTINGS_EDIT);
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;

  for (const key of ["primaryColor", "secondaryColor"] as const) {
    const v = data[key];
    if (v && !HEX.test(v)) {
      return NextResponse.json(
        { error: `Cor inválida em ${key}: use hexadecimal (#RRGGBB).` },
        { status: 400 }
      );
    }
  }
  if (data.supportEmail && !z.string().email().safeParse(data.supportEmail).success) {
    return NextResponse.json({ error: "E-mail de suporte inválido." }, { status: 400 });
  }

  const row = await prisma.brandingSettings.upsert({
    where: { orgId: ctx.orgId },
    create: { orgId: ctx.orgId, ...data },
    update: data,
    select: { secondaryColor: true },
  });

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "ORG_BRANDING_UPDATE",
    result: "SUCCESS",
    resource: ctx.orgId,
    resourceType: "BrandingSettings",
    metadata: { fields: Object.keys(data) },
  });

  const brand = await getOrgBrand(ctx.orgId);
  return NextResponse.json({
    displayName: brand.displayName,
    supportEmail: brand.supportEmail ?? "",
    supportPhone: brand.supportPhone ?? "",
    logoUrl: brand.logoUrl ?? "",
    primaryColor: brand.primaryColor,
    secondaryColor: row.secondaryColor ?? "",
  });
}
