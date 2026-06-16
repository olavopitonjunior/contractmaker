import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor hex inválida");

const brandingSchema = z.object({
  logoUrl: z.string().url().nullish(),
  faviconUrl: z.string().url().nullish(),
  primaryColor: hex.nullish(),
  secondaryColor: hex.nullish(),
  emailHeader: z.string().max(20000).nullish(),
  emailFooter: z.string().max(20000).nullish(),
  poweredBy: z.boolean().optional(),
});

/** GET — branding atual do tenant. PATCH — edita (super_admin). */
export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;
  const branding = await prisma.brandingSettings.findUnique({ where: { orgId: params.orgId } });
  return NextResponse.json({ branding });
}

export async function PATCH(req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({ where: { id: params.orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const parsed = brandingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validação falhou", issues: parsed.error.flatten() }, { status: 400 });
  }
  // Só persiste chaves presentes no body (patch parcial).
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );

  const saved = await prisma.brandingSettings.upsert({
    where: { orgId: org.id },
    update: data,
    create: { orgId: org.id, ...data },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_BRANDING_UPDATED",
    result: "SUCCESS",
    resourceType: "BrandingSettings",
    resource: saved.id,
    metadata: { fields: Object.keys(data) },
  });

  return NextResponse.json({ ok: true, branding: saved });
}
