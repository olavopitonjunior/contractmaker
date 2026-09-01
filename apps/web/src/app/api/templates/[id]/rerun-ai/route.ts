import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";
import { getDocPlainText } from "@/lib/google/docs";
import { auditTemplateText, readDraftReport } from "@/lib/templates/pii-gate";

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
    select: { googleTemplateDocId: true, modalidade: true, engine: true, draftReport: true },
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
    // Uma nova passada NÃO apaga o que a ingestão mediu (slots, neutralização):
    // antes o relatório era sobrescrito inteiro e os avisos de slot sumiam da
    // revisão. PII é re-auditada no texto que a IA acabou de deixar; se a
    // releitura falhar, o relatório antigo NÃO é re-carimbado — o campo sai e o
    // gate da ativação mede de novo (ver route.ts). Banco e resposta recebem o
    // MESMO objeto.
    const next: Record<string, unknown> = {
      ...readDraftReport(template.draftReport),
      ...(report as object),
    };
    try {
      const text = await getDocPlainText(template.googleTemplateDocId);
      if (text) next.pii = auditTemplateText(text);
      else delete next.pii;
    } catch (err) {
      console.error("[templates/rerun-ai] não consegui reler o doc pra auditar PII:", err);
      delete next.pii;
    }
    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { draftReport: next as object },
    });
    return NextResponse.json({ report: next });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha na revisão por IA." },
      { status: 502 }
    );
  }
}
