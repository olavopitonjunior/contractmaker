import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getDocPlainText } from "@/lib/google/docs";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { splitDocParagraphs } from "@/lib/templates/insertion-report";

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

  let text: string;
  try {
    text = await getDocPlainText(template.googleTemplateDocId);
  } catch (err) {
    // Sem o try/catch o `invalid_grant` cru subia como 500 sem corpo útil.
    console.error("[templates/doc-text] Erro ao ler o Doc:", err);
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }

  // Divisor compartilhado: `paragraphIndex` desta rota, das checagens
  // semânticas e da tela precisam apontar para o MESMO parágrafo.
  return NextResponse.json({ paragraphs: splitDocParagraphs(text) });
}
