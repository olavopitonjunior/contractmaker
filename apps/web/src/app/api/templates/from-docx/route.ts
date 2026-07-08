import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { uploadFileAsGoogleDoc } from "@/lib/google/upload-file-as-gdoc";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";

export const runtime = "nodejs";
export const maxDuration = 120;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;

const MODALIDADES = [
  "locacao",
  "locacao_comercial",
  "a_vista",
  "financiamento",
  // Contrato de administração de locação (imobiliária ↔ proprietário). O modelo
  // da imobiliária vira template engine="google_docs" igual aos demais; a
  // geração (generateAdministracaoContractForDeal) copia o doc e substitui os
  // placeholders via buildLocacaoPlaceholderMap (o deal de adm é um deal de
  // locação, mesmo shape de dados).
  "administracao_locacao",
];

const SCHEMA_TYPE_BY_MODALIDADE: Record<string, string> = {
  locacao: "locacao_residencial_v1",
  locacao_comercial: "locacao_comercial_v1",
  a_vista: "compra_venda_v2",
  financiamento: "compra_venda_v2",
  administracao_locacao: "administracao_locacao_v1",
};

/**
 * POST /api/templates/from-docx (multipart)
 *
 * Ingestão "modelo da imobiliária → template": sobe o DOCX como Google Doc
 * nativo (layout/timbrado preservados, no Drive da org quando conectada),
 * cria ContractTemplate engine="google_docs" em status DRAFT e roda o pass
 * de IA que insere {{placeholders}} (best-effort — falha não bloqueia; o
 * operador revisa e ajusta na página de revisão antes de ativar).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  // Id efetivo (owner impersonado sob "testar como"; senão o próprio usuário).
  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem criar templates." },
      { status: 403 }
    );
  }
  if (!isGoogleDocsFeatureEnabled()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está habilitada." },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  const modalidade = String(formData.get("modalidade") ?? "");
  const name = (String(formData.get("name") ?? "").trim() || null) ?? null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo file ausente" }, { status: 400 });
  }
  if (!MODALIDADES.includes(modalidade)) {
    return NextResponse.json(
      { error: `modalidade inválida (aceitas: ${MODALIDADES.join(", ")})` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 20MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // DOCX é um ZIP — valida o magic header (PK\3\4) contra renomeados.
  const isZip =
    buffer.length > 8 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  if (!isZip) {
    return NextResponse.json(
      { error: "Arquivo não parece ser um DOCX válido" },
      { status: 422 }
    );
  }

  const templateName =
    name ?? `Modelo da imobiliária — ${file.name.replace(/\.docx$/i, "")}`;

  let uploaded: { docId: string; webViewLink: string; embedLink: string };
  try {
    uploaded = await uploadFileAsGoogleDoc({
      buffer,
      sourceMime: DOCX_MIME,
      name: `[MODELO] ${templateName}`,
      orgId: org.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao converter DOCX em Google Doc: ${msg}` },
      { status: 502 }
    );
  }

  const template = await prisma.contractTemplate.create({
    data: {
      orgId: org.id,
      name: templateName,
      description: "Template criado a partir do modelo DOCX da imobiliária.",
      engine: "google_docs",
      status: "draft",
      isDefault: false,
      googleTemplateDocId: uploaded.docId,
      modalidade,
      schemaType: SCHEMA_TYPE_BY_MODALIDADE[modalidade],
      handlebarsSource: "<!-- engine=google_docs: a fonte é o Google Doc -->",
      version: "1.0.0",
    },
  });

  // Pass de IA best-effort: insere {{placeholders}} no doc. Falha não
  // bloqueia — o template fica draft e o operador faz manualmente na revisão.
  let report = null;
  try {
    report = await insertPlaceholdersWithAI({
      docId: uploaded.docId,
      modalidade,
      orgId: org.id,
    });
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: { draftReport: report as object },
    });
  } catch (err) {
    console.error("[templates/from-docx] Pass de IA falhou (segue draft):", err);
  }

  return NextResponse.json({
    templateId: template.id,
    docId: uploaded.docId,
    webViewLink: uploaded.webViewLink,
    embedLink: uploaded.embedLink,
    report,
  });
}
