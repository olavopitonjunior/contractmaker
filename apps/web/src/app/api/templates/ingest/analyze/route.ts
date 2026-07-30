import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules } from "@/lib/modules/read";
import { MODULE_CATALOG, type ModuleKey } from "@/lib/modules/catalog";
import { extractPlainText } from "@/lib/ai/ocr";
import { extractDocx } from "@/lib/extraction/docx";
import { classifyKnowledgeUpload } from "@/lib/knowledge/upload-classifier";
import { countClauseHeaders } from "@/lib/knowledge/clause-segmenter";
import {
  computeSourceHash,
  findDuplicateTemplate,
} from "@/lib/templates/upload-dedup";
import {
  ingestDocTypesForModules,
  suggestDocType,
  type IngestDocType,
} from "@/lib/templates/ingestion-types";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_MIME = "application/pdf";
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Corte do texto devolvido ao cliente. A triagem usa o texto pra AGRUPAR
 * modelos parecidos no browser (`lib/templates/consolidation.ts`) — um contrato
 * inteiro cabe folgado em 200k chars e o corte protege a resposta de um PDF
 * escaneado de 300 páginas.
 */
const MAX_TEXT_CHARS = 200_000;

function sniff(buffer: Buffer): "pdf" | "docx" | null {
  if (buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")) return "pdf";
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "docx";
  }
  return null;
}

/**
 * POST /api/templates/ingest/analyze (multipart)
 *
 * Etapa de ANÁLISE da central de ingestão: um arquivo por request (a fila é
 * sequencial no cliente, igual à do upload de modelos — o pipeline de extração é
 * pesado). NADA é criado aqui; a rota só lê o arquivo e devolve o que a tela de
 * triagem precisa pra montar o card:
 *
 *  - `text`           texto extraído (DOCX via mammoth, PDF via Gemini OCR) —
 *                     o cliente usa pra agrupar modelos quase idênticos
 *  - `classification` `upload-classifier` (heurística + desempate por IA)
 *  - `suggestion`     palpite do tipo NA LINGUAGEM DO USUÁRIO + motivo curto
 *  - `docTypes`       os tipos oferecidos a ESTA org (filtrados pelos módulos)
 *  - `duplicate`      template não-arquivado com o mesmo SHA-256 (aviso, não erro)
 *
 * A criação acontece depois, quando o operador confirma: `from-docx` (modelo),
 * `knowledge/upload` (cláusulas/acervo) ou `ingest/clauses` (cláusulas de slot).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem enviar documentos da imobiliária." },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo file ausente" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 20MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind) {
    return NextResponse.json(
      { error: "Formato não suportado — envie DOCX ou PDF." },
      { status: 422 }
    );
  }

  let text: string;
  try {
    text =
      kind === "pdf"
        ? await extractPlainText(buffer, PDF_MIME, { orgId: org.id, userId: effUserId })
        : (await extractDocx(buffer)).text;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Falha ao extrair o texto do documento.",
      },
      { status: 502 }
    );
  }

  if (!text || text.trim().length < 20) {
    return NextResponse.json(
      { error: "Não foi possível extrair texto suficiente do documento." },
      { status: 422 }
    );
  }

  const [classification, modules] = await Promise.all([
    classifyKnowledgeUpload(text, file.name, { orgId: org.id, userId: effUserId }),
    getOrgModules(org.id),
  ]);

  const enabledModules = MODULE_CATALOG.map((m) => m.key).filter(
    (m: ModuleKey) => modules.enabled[m]
  );
  const docTypes = ingestDocTypesForModules(enabledModules);

  const raw = suggestDocType({
    classificationKind: classification.kind,
    classificationReason: classification.reason,
    filename: file.name,
    text,
  });
  // O palpite pode cair num tipo de módulo desligado (um DOCX de venda numa org
  // só-locação). Nesse caso o card abre SEM tipo pré-selecionado — perguntar é
  // melhor que sugerir algo que o operador nem consegue escolher.
  const allowed = docTypes.some((d) => d.key === raw.type);
  const suggestion = allowed
    ? raw
    : {
        type: null as IngestDocType | null,
        subOption: undefined,
        reason: `${raw.reason} Esse tipo não está habilitado nos módulos desta imobiliária.`,
      };

  // Dedup é AVISO, não bloqueio: a criação (from-docx) é que devolve 409.
  const sourceHash = computeSourceHash(buffer);
  const duplicate =
    kind === "docx" ? await findDuplicateTemplate(prisma, org.id, sourceHash) : null;

  return NextResponse.json({
    fileKind: kind,
    filename: file.name,
    sourceHash,
    text: text.slice(0, MAX_TEXT_CHARS),
    truncated: text.length > MAX_TEXT_CHARS,
    clauseCount: countClauseHeaders(text),
    classification: {
      kind: classification.kind,
      confidence: classification.confidence,
      reason: classification.reason,
    },
    suggestion,
    docTypes,
    duplicate,
  });
}
