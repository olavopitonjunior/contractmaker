import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — logos não precisam ser grandes

/**
 * POST /api/financeiro/branding/logo
 *
 * Upload de logo da organização para Vercel Blob. Atualiza
 * `OrgFinancialSettings.brandLogoUrl` com a URL pública do blob.
 *
 * Multipart com campo `file`. Tipos permitidos: PNG/JPG/WEBP/SVG, max 2MB.
 */
export async function POST(req: NextRequest) {
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

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Tipo inválido: ${file.type}. Permitidos: PNG, JPG, WEBP, SVG.`,
      },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Arquivo excede 2 MB" },
      { status: 400 }
    );
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN não configurado — upload indisponível. Use URL externa em vez disso.",
      },
      { status: 503 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const pathname = `branding/${ctx.orgId}/logo-${Date.now()}.${ext}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type,
      token,
    });

    // Persiste URL em OrgFinancialSettings (per-account a partir desta migration).
    // Usa a conta ativa do user com cap configure.
    const url2 = new URL(req.url);
    const accountIdHint = url2.searchParams.get("accountId");
    const resolved = await resolveAsaasAccount({
      userId: ctx.userId,
      orgId: ctx.orgId,
      hintAccountId: accountIdHint,
      requireCapability: "configure",
    });
    if (!resolved) {
      return NextResponse.json(
        { error: "Nenhuma conta Asaas configurável encontrada" },
        { status: 422 }
      );
    }
    await prisma.orgFinancialSettings.upsert({
      where: { accountId: resolved.account.id },
      create: {
        orgId: ctx.orgId,
        accountId: resolved.account.id,
        brandLogoUrl: blob.url,
      },
      update: { brandLogoUrl: blob.url },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "BRANDING_UPDATED",
        result: "SUCCESS",
        resourceType: "org_financial_settings",
        resource: `org_financial_settings:${ctx.orgId}`,
        metadata: { field: "brandLogoUrl", size: file.size, mime: file.type },
      }
    );

    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (err) {
    console.error("[logo upload]", err);
    return NextResponse.json({ error: "Falha no upload" }, { status: 500 });
  }
}
