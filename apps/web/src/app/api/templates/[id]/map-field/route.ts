import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getDocsClient } from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import { isKnownToken } from "@/lib/templates/placeholder-catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  token: z.string().trim().min(1),
  phrase: z.string().min(2),
});

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * POST /api/templates/[id]/map-field — mapeia um campo manualmente: substitui o
 * TRECHO literal selecionado pelo `{{token}}` no Google Doc do template (o mesmo
 * `replaceAllText` que a IA usa). Usado pelo painel de "arrastar/clicar chave no
 * texto" da revisão. Recusa trecho que aparece 0 ou >1 vezes (evita ambiguidade).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "token e trecho são obrigatórios." }, { status: 400 });
  }
  const { token, phrase } = parsed.data;

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { googleTemplateDocId: true, modalidade: true, engine: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json({ error: "Modelo não é Google Docs." }, { status: 400 });
  }
  if (!isKnownToken(token, template.modalidade ?? "a_vista")) {
    return NextResponse.json({ error: `Chave desconhecida: ${token}` }, { status: 400 });
  }

  // Unicidade: o replaceAllText do Docs não atravessa parágrafos e trocaria TODAS
  // as ocorrências — exige trecho que aparece exatamente 1 vez.
  const text = await getDocPlainText(template.googleTemplateDocId);
  const occ = text.split(phrase).length - 1;
  if (occ === 0) {
    return NextResponse.json({ error: "Trecho não encontrado no documento." }, { status: 422 });
  }
  if (occ > 1) {
    return NextResponse.json(
      { error: "Trecho aparece mais de uma vez — selecione algo mais específico." },
      { status: 422 }
    );
  }

  const docs = getDocsClient();
  await docs.documents.batchUpdate({
    documentId: template.googleTemplateDocId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: { text: phrase, matchCase: true },
            replaceText: `{{${token}}}`,
          },
        },
      ],
    },
  });

  return NextResponse.json({ ok: true, token });
}
