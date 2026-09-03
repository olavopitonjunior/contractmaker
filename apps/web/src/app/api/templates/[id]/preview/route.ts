import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import {
  buildTemplatePreviewHtml,
  resolvePreviewFixture,
} from "@/lib/templates/preview-context";

// Handlebars roda em node.
export const runtime = "nodejs";

/**
 * POST /api/templates/[id]/preview — documento de exemplo do template.
 *
 * Duas engines, dois modos:
 *
 *  - `handlebars` → renderiza o source com a amostra da modalidade e devolve o
 *    HTML. A tela mostra num `<iframe sandbox="">` com `srcDoc`. NÃO toca o
 *    Google: antes o HTML era subido pro Drive (`uploadHtmlAsGoogleDoc`) só pra
 *    ter uma URL de iframe, e com o refresh token da org expirado — semanal em
 *    staging, projeto OAuth em modo "Testing" — o preview inteiro morria com
 *    "Falha ao subir Google Doc: invalid_grant" já tendo o documento pronto em
 *    memória.
 *
 *  - `google_docs` → o Doc É a fonte do texto; devolve a URL de embed dele.
 *
 * Não grava nada: o preview é sempre renderizado na hora (o cache por
 * `previewSourceHash` existia só pra evitar reupload no Drive).
 */
export async function POST(
  req: NextRequest,
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

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });

  if (!template || template.orgId !== org.id) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  // Templates engine="google_docs" usam o doc original como preview — não
  // precisa renderizar Handlebars nem gerar nada novo.
  if (template.engine === "google_docs") {
    if (!isGoogleDocsFeatureEnabled()) {
      return NextResponse.json(
        { error: "Integração Google Docs não está habilitada nesta org." },
        { status: 503 }
      );
    }
    if (!template.googleTemplateDocId) {
      return NextResponse.json(
        { error: "Template Google Docs sem doc associado." },
        { status: 400 }
      );
    }

    // `sample: true` — a prévia PREENCHIDA. Sem ela, o único "preview" de um
    // modelo google_docs era o próprio Doc com `{{chaves}}` cruas: o operador
    // via o relatório e o documento com chaves, e nunca via como o contrato
    // SAI. Foi decidindo no escuro que 16 modelos da Trio foram aprovados com
    // 10 erros semânticos.
    if (body?.sample === true) {
      try {
        const [{ renderGoogleDocsPreview }, { loadOrgRecebimento }] = await Promise.all([
          import("@/lib/templates/gdoc-preview"),
          import("@/lib/contracts/org-recebimento"),
        ]);
        const previa = await renderGoogleDocsPreview({
          templateId: template.id,
          orgId: org.id,
          docId: template.googleTemplateDocId,
          modalidade: template.modalidade ?? "locacao",
          // Perfil REAL da org: é o que o operador confere na cláusula de
          // corretagem — se a conta da imobiliária sai certa.
          orgRecebimento: await loadOrgRecebimento(org.id),
        });
        return NextResponse.json({ mode: "google_docs_sample", ...previa });
      } catch (err) {
        console.error("[templates/preview] prévia com amostra falhou:", err);
        const { googleErrorMessage } = await import("@/lib/google/auth-error");
        return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
      }
    }

    return NextResponse.json({
      mode: "google_docs",
      docId: template.googleTemplateDocId,
      embedUrl: `https://docs.google.com/document/d/${template.googleTemplateDocId}/preview`,
      webViewLink: `https://docs.google.com/document/d/${template.googleTemplateDocId}/edit`,
    });
  }

  // A amostra vem da MODALIDADE do template — venda deixa escolher entre à
  // vista e financiamento; locação, administração e proposta têm uma só. O que
  // o body pede é validado contra essa lista (schema errado = documento vazio).
  const fixture = resolvePreviewFixture(template.modalidade, body?.modalidade);

  let html: string;
  try {
    html = buildTemplatePreviewHtml({
      handlebarsSource: template.handlebarsSource,
      modalidade: template.modalidade,
      fixture,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao renderizar Handlebars: ${msg}` },
      { status: 422 }
    );
  }

  return NextResponse.json({ mode: "handlebars", html, fixture });
}
