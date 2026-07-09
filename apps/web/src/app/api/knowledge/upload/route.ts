import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItemRows, embedKnowledgeItem } from "@/lib/ai/knowledge";
import { extractPlainText } from "@/lib/ai/ocr";
import { extractDocx } from "@/lib/extraction/docx";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;
const VALID_CATEGORIES = ["legislation", "model", "rule", "glossary", "clause"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

/** Detecta o tipo real pelo magic-byte (não confia no mime declarado). */
function sniff(buffer: Buffer): "pdf" | "docx" | null {
  if (buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")) return "pdf";
  // DOCX é um zip → magic PK\x03\x04
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return "docx";
  }
  return null;
}

/**
 * POST /api/knowledge/upload (multipart)
 *
 * Ingestão de documento (PDF/DOCX) na base de conhecimento: extrai o texto
 * (PDF via Gemini OCR, DOCX via mammoth), cria as linhas do KnowledgeItem e
 * gera embeddings em background (waitUntil — a chamada ao Voyage não segura a
 * resposta). Sem VOYAGE_API_KEY, o item segue pesquisável via ILIKE.
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
      { error: "Apenas owner/admin podem subir documentos." },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Multipart inválido." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 20MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind) {
    return NextResponse.json(
      { error: "Formato não suportado — envie PDF ou DOCX." },
      { status: 422 }
    );
  }

  // Categoria (default clause) + título + tags.
  const rawCategory = String(formData.get("category") ?? "clause");
  const category: Category = VALID_CATEGORIES.includes(rawCategory as Category)
    ? (rawCategory as Category)
    : "clause";
  const rawTitle = String(formData.get("title") ?? "").trim();
  const title = rawTitle || file.name.replace(/\.(pdf|docx)$/i, "").trim() || "Documento";
  const rawTags = String(formData.get("tags") ?? "").trim();
  const tags = rawTags
    ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  // Extração de texto.
  let text: string;
  try {
    if (kind === "pdf") {
      text = await extractPlainText(buffer, PDF_MIME, {
        orgId: org.id,
        userId: effUserId,
      });
    } else {
      const { text: docxText } = await extractDocx(buffer);
      text = docxText;
    }
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

  const { parentId, embedTargets } = await createKnowledgeItemRows({
    orgId: org.id,
    category,
    title,
    content: text,
    tags,
    source: kind === "pdf" ? "upload_pdf" : "upload_docx",
    createdBy: effUserId,
  });

  // Embedding best-effort em background — não segura a resposta no Voyage.
  waitUntil(embedKnowledgeItem(embedTargets, { orgId: org.id, userId: effUserId }));

  return NextResponse.json(
    { id: parentId, title, category, chunks: embedTargets.length },
    { status: 201 }
  );
}
