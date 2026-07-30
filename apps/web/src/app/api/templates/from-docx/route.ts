import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { uploadFileAsGoogleDoc } from "@/lib/google/upload-file-as-gdoc";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";
import {
  UPLOAD_MODALIDADES,
  schemaTypeForModalidade,
} from "@/lib/contracts/template-category";
import {
  computeSourceHash,
  findDuplicateTemplate,
  resolveUniqueTemplateName,
  type DuplicateTemplate,
} from "@/lib/templates/upload-dedup";

export const runtime = "nodejs";
export const maxDuration = 120;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;

// Modalidades aceitas na ingestão de modelo. `administracao_locacao` é o
// contrato de administração (imobiliária ↔ proprietário): vira template
// engine="google_docs" igual aos demais; a geração
// (generateAdministracaoContractForDeal) copia o doc e substitui os
// placeholders via buildLocacaoPlaceholderMap (o deal de adm é um deal de
// locação, mesmo shape de dados).
const MODALIDADES: string[] = [...UPLOAD_MODALIDADES];

/** Sinaliza o 409 de dentro da transação do claim (aborta e faz rollback). */
class DuplicateTemplateError extends Error {
  constructor(readonly existing: DuplicateTemplate) {
    super("DUPLICATE_TEMPLATE");
  }
}

/**
 * Remove a claim-row quando o pipeline falha. Best-effort: um erro aqui só
 * significa que o hash segue ocupado por um draft — o operador reingere com
 * `force=true`.
 */
async function dropClaimRow(id: string): Promise<void> {
  await prisma.contractTemplate.delete({ where: { id } }).catch((err) => {
    console.error("[templates/from-docx] falha ao limpar a claim-row:", err);
  });
}

/**
 * POST /api/templates/from-docx (multipart)
 *
 * Ingestão "modelo da imobiliária → template": sobe o DOCX como Google Doc
 * nativo (layout/timbrado preservados, no Drive da org quando conectada),
 * cria ContractTemplate engine="google_docs" em status DRAFT e roda o pass
 * de IA que insere {{placeholders}} (best-effort — falha não bloqueia; o
 * operador revisa e ajusta na página de revisão antes de ativar).
 *
 * UM arquivo por request — o pipeline Drive + IA é pesado e cabe no
 * maxDuration de 120s. O upload em lote da UI é uma fila sequencial client-side
 * que chama esta rota N vezes.
 *
 * Dedup por conteúdo (SHA-256 do DOCX em `ContractTemplate.sourceHash`):
 * arquivo já ingerido no org (e não arquivado) devolve 409 DUPLICATE_TEMPLATE
 * sem criar nada. `force=true` no formData ignora o dedup — o operador decide.
 * Colisão de NOME não bloqueia: sufixa " (2)", " (3)"… (nome é rótulo, o hash
 * é que é identidade).
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
  const force = String(formData.get("force") ?? "") === "true";

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

  const sourceHash = computeSourceHash(buffer);
  const baseName =
    name ?? `Modelo da imobiliária — ${file.name.replace(/\.docx$/i, "")}`;

  // ─── CLAIM-ROW ────────────────────────────────────────────────────────────
  // O dedup-check e a criação da row rodam na MESMA transação e ANTES do
  // pipeline Drive+IA. O check ficava separado do create por ~2min de pipeline:
  // duas requests com o MESMO arquivo (o upload em lote da UI, um duplo-clique)
  // passavam as duas pelo check e criavam dois drafts.
  //
  // A row nasce sem `googleTemplateDocId` — é um CLAIM do hash. A 2ª request
  // concorrente enxerga a claim-row (status "draft" participa do dedup) e leva
  // 409 na hora. `force=true` continua pulando o check.
  let template: { id: string; name: string };
  try {
    template = await prisma.$transaction(async (tx) => {
      if (!force) {
        const existing = await findDuplicateTemplate(tx, org.id, sourceHash);
        if (existing) throw new DuplicateTemplateError(existing);
      }
      const templateName = await resolveUniqueTemplateName(tx, org.id, baseName);
      return tx.contractTemplate.create({
        data: {
          orgId: org.id,
          name: templateName,
          description: "Template criado a partir do modelo DOCX da imobiliária.",
          engine: "google_docs",
          status: "draft",
          isDefault: false,
          // Preenchido depois que o Drive converter o DOCX.
          googleTemplateDocId: null,
          modalidade,
          schemaType: schemaTypeForModalidade(modalidade),
          handlebarsSource: "<!-- engine=google_docs: a fonte é o Google Doc -->",
          version: "1.0.0",
          sourceHash,
        },
        select: { id: true, name: true },
      });
    });
  } catch (err) {
    if (err instanceof DuplicateTemplateError) {
      return NextResponse.json(
        {
          code: "DUPLICATE_TEMPLATE",
          error: "Este arquivo já foi importado como template.",
          existing: err.existing,
        },
        { status: 409 }
      );
    }
    throw err;
  }

  // Daqui pra frente a claim-row EXISTE. Qualquer falha tem de removê-la: um
  // draft sem `googleTemplateDocId` seria um template quebrado na listagem E
  // ocuparia o hash pra sempre (o operador nunca mais reingeriria o arquivo).
  let uploaded: { docId: string; webViewLink: string; embedLink: string };
  try {
    uploaded = await uploadFileAsGoogleDoc({
      buffer,
      sourceMime: DOCX_MIME,
      name: `[MODELO] ${template.name}`,
      orgId: org.id,
    });
  } catch (err) {
    await dropClaimRow(template.id);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao converter DOCX em Google Doc: ${msg}` },
      { status: 502 }
    );
  }

  try {
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: { googleTemplateDocId: uploaded.docId },
    });
  } catch (err) {
    await dropClaimRow(template.id);
    throw err;
  }

  // Pass de IA best-effort: insere {{placeholders}} no doc. Falha não
  // bloqueia — o template fica draft e o operador faz manualmente na revisão.
  // (Não derruba a claim-row: o doc já existe e o template é utilizável.)
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
    name: template.name,
    docId: uploaded.docId,
    webViewLink: uploaded.webViewLink,
    embedLink: uploaded.embedLink,
    report,
  });
}
