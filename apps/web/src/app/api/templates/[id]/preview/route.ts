import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { uploadHtmlAsGoogleDoc } from "@/lib/google/upload-rendered-html";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { googleApplyStylePreset } from "@/lib/ai/google-tool-handlers";
import { getPreviewSampleData } from "@/lib/templates/preview-sample-data";
import { enrichContractData } from "@/lib/services/contract-generation";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

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

  if (!isGoogleDocsFeatureEnabled()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está habilitada nesta org." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const fixtureModalidade =
    body?.modalidade === "financiamento" ? "financiamento" : "a_vista";
  const force: boolean = body?.force === true;

  // Templates engine="google_docs" usam o doc original como preview — não
  // precisa renderizar Handlebars nem gerar nada novo.
  if (template.engine === "google_docs") {
    if (!template.googleTemplateDocId) {
      return NextResponse.json(
        { error: "Template Google Docs sem doc associado." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      docId: template.googleTemplateDocId,
      embedUrl: `https://docs.google.com/document/d/${template.googleTemplateDocId}/preview`,
      webViewLink: `https://docs.google.com/document/d/${template.googleTemplateDocId}/edit`,
      cached: true,
      mode: "google_docs",
    });
  }

  const sampleData = getPreviewSampleData(fixtureModalidade);
  const enriched = enrichContractData(sampleData);

  // Hash combina source + fixture pra detectar tanto edição do template
  // quanto troca da modalidade do preview.
  const previewKey = sha(template.handlebarsSource + ":" + fixtureModalidade);

  const cachedFresh =
    !force &&
    template.googleTemplateDocId &&
    template.previewSourceHash === previewKey;

  if (cachedFresh && template.googleTemplateDocId) {
    return NextResponse.json({
      docId: template.googleTemplateDocId,
      embedUrl: `https://docs.google.com/document/d/${template.googleTemplateDocId}/preview`,
      webViewLink: `https://docs.google.com/document/d/${template.googleTemplateDocId}/edit`,
      cached: true,
      mode: "handlebars",
    });
  }

  let html: string;
  try {
    html = renderContratoHTML(template.handlebarsSource, enriched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao renderizar Handlebars: ${msg}` },
      { status: 422 }
    );
  }

  let docId: string;
  let webViewLink: string;
  try {
    const uploaded = await uploadHtmlAsGoogleDoc({
      htmlContent: html,
      name: `[PREVIEW] ${template.name} — ${fixtureModalidade}`,
    });
    docId = uploaded.docId;
    webViewLink = uploaded.webViewLink;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[templates/preview] Falha ao subir GDoc:", err);
    return NextResponse.json(
      { error: `Falha ao subir Google Doc: ${msg}` },
      { status: 502 }
    );
  }

  // Aplica DocumentStyle default — falha não bloqueia o preview.
  try {
    const defaultStyle = await prisma.documentStyle.findFirst({
      where: { orgId: org.id, isDefault: true },
    });
    if (defaultStyle) {
      await googleApplyStylePreset(docId, {
        fontFamily: defaultStyle.fontFamily,
        fontSizeBase: defaultStyle.fontSizeBase,
        lineHeight: defaultStyle.lineHeight,
        colorPrimary: defaultStyle.colorPrimary,
        marginTopMm: defaultStyle.marginTopMm,
        marginBottomMm: defaultStyle.marginBottomMm,
        marginLeftMm: defaultStyle.marginLeftMm,
        marginRightMm: defaultStyle.marginRightMm,
      });
    }
  } catch (err) {
    console.error("[templates/preview] Falha ao aplicar DocumentStyle:", err);
  }

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      googleTemplateDocId: docId,
      previewSourceHash: previewKey,
      previewUpdatedAt: new Date(),
    },
  });

  return NextResponse.json({
    docId,
    embedUrl: `https://docs.google.com/document/d/${docId}/preview`,
    webViewLink,
    cached: false,
    mode: "handlebars",
  });
}
