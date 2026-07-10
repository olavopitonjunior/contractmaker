import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";

export const runtime = "nodejs";
export const maxDuration = 120;

/** owner/admin da org (impersonation-aware). */
async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * POST /api/templates/[id]/rerun-ai — "Pedir revisão pela IA": re-roda o pass de
 * inserção de placeholders no Google Doc do template e devolve o relatório
 * (o que inseriu / pulou por dúvida / não mapeou / obrigatórias faltantes).
 * Idempotente: a IA mapeia texto literal → chaves já postas não são re-mexidas.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { googleTemplateDocId: true, modalidade: true, engine: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "A revisão por IA só vale para modelos importados (Google Docs)." },
      { status: 400 }
    );
  }

  try {
    const report = await insertPlaceholdersWithAI({
      docId: template.googleTemplateDocId,
      modalidade: template.modalidade ?? "a_vista",
      orgId: org.id,
    });
    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { draftReport: report as object },
    });
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha na revisão por IA." },
      { status: 502 }
    );
  }
}
