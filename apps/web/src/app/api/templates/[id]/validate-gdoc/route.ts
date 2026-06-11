import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import {
  catalogForModalidade,
  requiredTokens,
} from "@/lib/templates/placeholder-catalog";

/**
 * POST /api/templates/[id]/validate-gdoc — revalida os placeholders do
 * Doc-modelo de um template engine="google_docs" contra o catálogo da
 * modalidade. Usado pela página de revisão (botão "Revalidar") e antes da
 * ativação.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está configurada." },
      { status: 503 }
    );
  }

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });
  if (!template || template.orgId !== org.id) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "Template não é engine google_docs com doc associado." },
      { status: 400 }
    );
  }

  const modalidade = template.modalidade ?? "a_vista";

  try {
    const text = await getDocPlainText(template.googleTemplateDocId);
    const found = extractPlaceholdersFromText(text);
    const catalog = catalogForModalidade(modalidade);
    const known = new Set(catalog.map((d) => d.token));
    const unknown = found.filter((t) => !known.has(t));
    const foundSet = new Set(found);
    const missingRequired = requiredTokens(modalidade).filter((t) => !foundSet.has(t));

    // Atualiza o relatório do draft com o estado mais recente da validação.
    const prevReport =
      template.draftReport && typeof template.draftReport === "object"
        ? (template.draftReport as Record<string, unknown>)
        : {};
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: {
        draftReport: {
          ...prevReport,
          missingRequired,
          lastValidatedAt: new Date().toISOString(),
        },
      },
    });

    return NextResponse.json({
      ok: true,
      docId: template.googleTemplateDocId,
      found,
      unknown,
      missingRequired,
      catalog: catalog.map((d) => ({
        token: d.token,
        label: d.label,
        description: d.description,
        required: d.required,
        kind: d.kind,
        present: foundSet.has(d.token),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[templates/validate-gdoc/id] Erro:", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
