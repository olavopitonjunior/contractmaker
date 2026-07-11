import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getDocPlainText } from "@/lib/google/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * GET /api/templates/[id]/doc-text — parágrafos do Google Doc do template (texto
 * puro), pra o painel de mapeamento manual de chaves na revisão.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { googleTemplateDocId: true, engine: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json({ error: "Modelo não é Google Docs." }, { status: 400 });
  }

  const text = await getDocPlainText(template.googleTemplateDocId);
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return NextResponse.json({ paragraphs });
}
