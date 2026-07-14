import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAuth } from "@/lib/auth/context";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — logos não precisam ser grandes

/**
 * POST /api/org/branding/logo — upload do logo da imobiliária pro Vercel Blob,
 * gravando em `BrandingSettings.logoUrl` (fonte canônica).
 *
 * Substitui `/api/financeiro/branding/logo`, que exigia uma CONTA ASAAS
 * configurável e devolvia 422 sem ela: uma imobiliária recém-cadastrada, que
 * ainda não abriu conta de recebimento, não conseguia sequer subir o próprio
 * logo. Marca não depende de meio de pagamento.
 *
 * Multipart com campo `file`. PNG/JPG/WEBP/SVG, max 2MB.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    const effUserId = await getEffectiveUserId(ctx.userId);
    await requirePermission({
      userId: effUserId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
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
      { error: `Tipo inválido: ${file.type}. Permitidos: PNG, JPG, WEBP, SVG.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 2 MB" }, { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN não configurado — upload indisponível. Use uma URL externa.",
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

    await prisma.brandingSettings.upsert({
      where: { orgId: ctx.orgId },
      create: { orgId: ctx.orgId, logoUrl: blob.url },
      update: { logoUrl: blob.url },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "ORG_BRANDING_UPDATE",
        result: "SUCCESS",
        resourceType: "BrandingSettings",
        resource: ctx.orgId,
        metadata: { field: "logoUrl", size: file.size, mime: file.type },
      }
    );

    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (err) {
    console.error("[org logo upload]", err);
    return NextResponse.json({ error: "Falha no upload" }, { status: 500 });
  }
}
