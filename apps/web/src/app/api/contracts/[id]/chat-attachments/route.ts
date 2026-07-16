import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { classifyAndExtract } from "@/lib/ai/ocr";
import { extractDocx } from "@/lib/extraction/docx";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // alguns navegadores enviam isso pra .docx legado / mime customizado
  "application/msword",
]);

// Cap do texto que viaja ao agente — protege budget de tokens.
const TEXT_CAP = 20_000;

/**
 * GET /api/contracts/[id]/chat-attachments?sessionId=...
 * Lista anexos de uma session (chamada quando a UI hidrata).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId obrigatorio" }, { status: 400 });
  }

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { contract: { select: { id: true, userId: true } } },
  });
  if (!session || session.contractId !== params.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && session.contract.userId !== auth.ident.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await prisma.chatAttachment.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      source: true,
      blobUrl: true,
      sourceUrl: true,
      byteSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    items.map((a) => ({
      id: a.id,
      name: a.name,
      source: a.source,
      blobUrl: a.blobUrl,
      sourceUrl: a.sourceUrl,
      byteSize: a.byteSize,
      createdAt: a.createdAt.toISOString(),
    }))
  );
}

/**
 * POST /api/contracts/[id]/chat-attachments
 * multipart com:
 *   - file: PDF ou DOCX (≤5MB)
 *   - sessionId: string (form field)
 *
 * Faz OCR (Gemini) pra PDF ou mammoth pra DOCX. Trunca em TEXT_CAP chars.
 * Sobe ao Vercel Blob, persiste ChatAttachment, retorna shape pro chip.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const sessionId = String(form?.get("sessionId") || "");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId obrigatorio" }, { status: 400 });
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatorio" }, { status: 400 });
  }

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      contract: {
        select: {
          id: true,
          userId: true,
          deal: { select: { pipeline: { select: { orgId: true } } } },
        },
      },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (
    !session ||
    session.contractId !== params.id ||
    session.contract.deal.pipeline.orgId !== auth.org.id
  ) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && session.contract.userId !== auth.ident.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = session.contract.deal.pipeline.orgId;

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Tipo invalido: ${file.type}. Aceitos: PDF, DOCX.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 5 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Extrai texto antes de subir — se OCR/parse falhar, abortamos sem
  // poluir o blob com algo que o agente nao vai conseguir usar.
  let extractedText = "";
  try {
    if (file.type === "application/pdf") {
      const result = await classifyAndExtract(
        buffer.toString("base64"),
        "application/pdf",
        { orgId, userId: auth.actor.effectiveUserId, contractId: params.id },
        { buffer }
      );
      extractedText = result.rawText || "";
    } else {
      const { text } = await extractDocx(buffer);
      extractedText = text || "";
    }
  } catch (err) {
    console.error("[chat-attachments] extract error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Falha ao extrair texto: ${err.message}`
            : "Falha ao extrair texto",
      },
      { status: 422 }
    );
  }

  if (extractedText.length > TEXT_CAP) {
    extractedText = extractedText.slice(0, TEXT_CAP) + "\n\n[...texto truncado]";
  }

  let blobUrl: string | null = null;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const ext = file.type === "application/pdf" ? "pdf" : "docx";
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const pathname = `contracts/${params.id}/chat-attachments/${sessionId}/${safeName}`;
      const blob = await put(pathname, file, {
        access: "public",
        contentType: file.type,
        token,
      });
      blobUrl = blob.url;
    } catch (err) {
      // Falha de upload nao e fatal — o texto extraido ja basta pro agente.
      console.error("[chat-attachments] blob upload error", err);
    }
  }

  const attachment = await prisma.chatAttachment.create({
    data: {
      sessionId,
      name: file.name || "documento",
      source: "upload",
      blobUrl,
      extractedText,
      byteSize: file.size,
    },
    select: {
      id: true,
      name: true,
      source: true,
      blobUrl: true,
      byteSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      id: attachment.id,
      name: attachment.name,
      source: attachment.source,
      blobUrl: attachment.blobUrl,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt.toISOString(),
      extractedChars: extractedText.length,
    },
    { status: 201 }
  );
}
