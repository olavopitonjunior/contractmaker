import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import {
  classifyAndExtract,
  classifyAndExtractBatch,
  prevalidateForOcr,
  type BatchItem,
} from "@/lib/ai/ocr";
import { extractFirstPages } from "@/lib/ai/pdf-utils";

export const runtime = "nodejs";
// Batch calls can take longer than single — 3 docs × ~30s Gemini + retry buffer.
export const maxDuration = 180;

const batchSchema = z.object({
  attachmentIds: z.array(z.string()).min(1).max(4),
});

const SUPPORTED_OCR_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

interface AttachmentWithBuffer {
  id: string;
  mime: string;
  contentHash: string | null;
  buffer: Buffer;
  cachedResult: { category: string | null; extractedData: object } | null;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar blob`);
    return Buffer.from(await res.arrayBuffer());
  }
  return downloadBufferFromUrl(url);
}

function humanizeExtractError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("safety") || lower.includes("blocked")) {
    return "O documento foi bloqueado pelo filtro de segurança do OCR. Tente um arquivo diferente.";
  }
  if (lower.includes("invalid image") || lower.includes("unsupported") || lower.includes("decode")) {
    return "Não foi possível ler o arquivo. Verifique se é uma imagem nítida ou um PDF de texto.";
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return "A extração demorou demais. Tente um arquivo menor ou clique em Tentar novamente.";
  }
  if (lower.includes("quota") || lower.includes("rate")) {
    return "Limite de uso da IA atingido temporariamente. Aguarde um minuto e tente novamente.";
  }
  if (lower.includes("500") || lower.includes("internal")) {
    return "O serviço de OCR retornou um erro interno para este arquivo. Tente outro formato ou outro documento.";
  }
  const clean = raw.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean.length < 200
    ? `Falha na extração: ${clean}`
    : "Falha na extração. Tente novamente ou use outro arquivo.";
}

/**
 * POST /api/forms/:token/attachments/batch-extract
 * Body: { attachmentIds: string[] }  (max 4)
 *
 * Runs OCR on up to 4 attachments in a single Gemini batch call.
 * Handles cache hits + pre-validation + fallback to individual calls on
 * batch failure. Returns results per-attachment so the client can update
 * each card independently.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true, orgId: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 }
    );
  }
  const { attachmentIds } = parsed.data;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "OCR indisponivel: GEMINI_API_KEY nao configurada" },
      { status: 503 }
    );
  }

  // Load all attachments in parallel
  const attachments = await prisma.formAttachment.findMany({
    where: { id: { in: attachmentIds }, formId: form.id },
  });
  if (attachments.length !== attachmentIds.length) {
    return NextResponse.json(
      { error: "Uma ou mais attachments não pertencem ao formulário" },
      { status: 404 }
    );
  }

  // Preserve request order (findMany may return in a different order)
  const orderedAttachments = attachmentIds.map(
    (id) => attachments.find((a) => a.id === id)!
  );

  // Per-attachment preparation: download buffer, check cache, pre-validate
  const prepared: Array<{
    attachment: (typeof orderedAttachments)[number];
    item: BatchItem | null;
    cachedResult: { category: string | null; extractedData: object } | null;
    error: string | null;
  }> = [];

  for (const att of orderedAttachments) {
    // Already extracted? return cached result directly.
    if (att.extractedData) {
      prepared.push({
        attachment: att,
        item: null,
        cachedResult: {
          category: att.category,
          extractedData: att.extractedData as object,
        },
        error: null,
      });
      continue;
    }

    // Content hash cache hit?
    if (att.contentHash) {
      const cached = await prisma.formAttachment.findFirst({
        where: {
          id: { not: att.id },
          contentHash: att.contentHash,
          extractedData: { not: Prisma.JsonNull },
          form: { orgId: form.orgId },
        },
        select: { category: true, extractedData: true },
        orderBy: { createdAt: "desc" },
      });
      if (cached && cached.extractedData) {
        await prisma.formAttachment.update({
          where: { id: att.id },
          data: {
            category: cached.category,
            extractedData: cached.extractedData as object,
          },
        });
        prepared.push({
          attachment: att,
          item: null,
          cachedResult: {
            category: cached.category,
            extractedData: cached.extractedData as object,
          },
          error: null,
        });
        continue;
      }
    }

    // MIME check
    if (!SUPPORTED_OCR_MIMES.includes(att.mime)) {
      prepared.push({
        attachment: att,
        item: null,
        cachedResult: null,
        error: `Tipo nao suportado para OCR: ${att.mime}`,
      });
      continue;
    }

    // Fetch + pre-validate + trim PDFs
    try {
      let buffer = await fetchBuffer(att.url);
      const prevalidationError = prevalidateForOcr(buffer, att.mime);
      if (prevalidationError) {
        prepared.push({
          attachment: att,
          item: null,
          cachedResult: null,
          error: prevalidationError,
        });
        continue;
      }
      // Trim multi-page PDFs to first 2 pages to save tokens
      if (att.mime === "application/pdf") {
        const trimmed = await extractFirstPages(buffer, 2);
        if (trimmed.trimmed) buffer = trimmed.buffer;
      }
      prepared.push({
        attachment: att,
        item: {
          base64Data: buffer.toString("base64"),
          mimeType: att.mime,
        },
        cachedResult: null,
        error: null,
      });
    } catch (err) {
      prepared.push({
        attachment: att,
        item: null,
        cachedResult: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Call batch OCR for items that need it
  const itemsToOcr = prepared
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.item !== null);

  let batchResults: Array<{
    documentType: string;
    fields: Record<string, string>;
    confidence: number;
  }> | null = null;

  if (itemsToOcr.length > 0) {
    try {
      const batchItems: BatchItem[] = itemsToOcr.map(({ p }) => p.item!);
      batchResults = await classifyAndExtractBatch(batchItems, {
        orgId: form.orgId,
      });
    } catch (batchErr) {
      // Batch failed — fallback to individual calls. This protects against
      // safety blocks on one doc poisoning the whole batch.
      console.warn(
        `[batch-extract] batch failed (${batchErr instanceof Error ? batchErr.message.slice(0, 100) : "?"}), falling back to individual calls`
      );
      batchResults = [];
      for (const { p } of itemsToOcr) {
        try {
          const result = await classifyAndExtract(
            p.item!.base64Data,
            p.item!.mimeType,
            { orgId: form.orgId },
            { skipPrevalidation: true }
          );
          batchResults.push({
            documentType: result.documentType,
            fields: result.fields,
            confidence: result.confidence,
          });
        } catch (err) {
          // Mark this specific item as errored and insert a null result
          p.error = humanizeExtractError(err instanceof Error ? err.message : String(err));
          batchResults.push({
            documentType: "outro",
            fields: {},
            confidence: 0,
          });
        }
      }
    }
  }

  // Persist results and build response
  const response: Array<{
    attachmentId: string;
    ok: boolean;
    cached: boolean;
    cacheSource?: string;
    category: string | null;
    extractedData: object | null;
    error: string | null;
  }> = [];

  let resultCursor = 0;
  for (const p of prepared) {
    if (p.cachedResult) {
      response.push({
        attachmentId: p.attachment.id,
        ok: true,
        cached: true,
        cacheSource: p.attachment.extractedData ? "existing" : "content_hash",
        category: p.cachedResult.category,
        extractedData: p.cachedResult.extractedData,
        error: null,
      });
      continue;
    }
    if (p.error) {
      response.push({
        attachmentId: p.attachment.id,
        ok: false,
        cached: false,
        category: null,
        extractedData: null,
        error: humanizeExtractError(p.error),
      });
      continue;
    }
    // This item was OCRed in the batch
    const result = batchResults?.[resultCursor++];
    if (!result) {
      response.push({
        attachmentId: p.attachment.id,
        ok: false,
        cached: false,
        category: null,
        extractedData: null,
        error: "Resultado do batch não encontrado",
      });
      continue;
    }

    const payload = {
      fields: result.fields,
      confidence: result.confidence,
    };
    await prisma.formAttachment.update({
      where: { id: p.attachment.id },
      data: {
        category: result.documentType,
        extractedData: payload as object,
      },
    });
    response.push({
      attachmentId: p.attachment.id,
      ok: true,
      cached: false,
      category: result.documentType,
      extractedData: payload,
      error: null,
    });
  }

  return NextResponse.json({ results: response });
}
