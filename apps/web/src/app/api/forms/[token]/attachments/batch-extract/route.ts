// ⚠️ DEPRECATED (Phase F.II, 2026-04-28)
//
// Esta rota disparava OCR síncrono em paralelo com o worker fire-and-forget
// de POST /attachments — ambos disputando o lock atômico extractingStartedAt.
// O perdedor da corrida retornava "Extração concorrente em andamento", o que
// flipava o card client-side para "failed" mesmo quando o worker eventualmente
// completava com sucesso. Sintoma observado: 1ª tentativa de upload falhava,
// retry funcionava.
//
// O cliente em DocumentosStep.tsx não chama mais este endpoint; depende
// exclusivamente do worker (src/lib/ai/ocr-worker.ts) + polling de GET
// /attachments. Esta rota fica como back-compat para clientes em cache de
// browser; pode ser removida com segurança após uma rodada de deploy.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import {
  classifyAndExtract,
  classifyAndExtractBatch,
  prevalidateForOcr,
  humanizeOcrError,
  type BatchItem,
} from "@/lib/ai/ocr";
import { extractFirstPages, OCR_MAX_PAGES } from "@/lib/ai/pdf-utils";

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

// Phase F.IV — humanizeOcrError shared helper (lib/ai/ocr.ts) com dedup de prefixo.
const humanizeExtractError = humanizeOcrError;

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
    select: { id: true, orgId: true, lockedAt: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  if (form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações" },
      { status: 403 },
    );
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
        const trimmed = await extractFirstPages(buffer, OCR_MAX_PAGES);
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

  // Atomically claim each item that still needs OCR. If another request is
  // already running Gemini for the same attachment id, skip it here so we
  // don't double-bill. The client can re-poll via single-extract to pick up
  // the result from the parallel worker. Stale locks (>2min) are taken over.
  const LOCK_STALE_MS = 2 * 60 * 1000;
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  for (const p of prepared) {
    if (p.item === null) continue; // cached or errored — no OCR needed
    const claim = await prisma.formAttachment.updateMany({
      where: {
        id: p.attachment.id,
        extractedData: { equals: Prisma.DbNull },
        OR: [
          { extractingStartedAt: null },
          { extractingStartedAt: { lt: staleBefore } },
        ],
      },
      data: { extractingStartedAt: new Date() },
    });
    if (claim.count === 0) {
      p.item = null;
      p.error =
        "Extração concorrente em andamento — aguarde alguns segundos e recarregue.";
    }
  }

  // Call batch OCR for items that need it. Key results by attachmentId so the
  // final loop doesn't rely on positional cursor alignment (which previously
  // drifted when an individual fallback item errored — the error was set on
  // p.error AND a placeholder pushed into batchResults, causing the next real
  // result to be picked up by the wrong attachment).
  const itemsToOcr = prepared.filter((p) => p.item !== null);

  type OcrResult = {
    documentType: string;
    fields: Record<string, string>;
    confidence: number;
  };
  const resultByAttachmentId = new Map<string, OcrResult>();

  if (itemsToOcr.length > 0) {
    try {
      const batchItems: BatchItem[] = itemsToOcr.map((p) => p.item!);
      const batchResults = await classifyAndExtractBatch(batchItems, {
        orgId: form.orgId,
      });
      // classifyAndExtractBatch guarantees batchResults.length === batchItems.length
      // and preserves input order (see ocr.ts asserts).
      itemsToOcr.forEach((p, i) => {
        const r = batchResults[i];
        if (r) {
          resultByAttachmentId.set(p.attachment.id, {
            documentType: r.documentType,
            fields: r.fields,
            confidence: r.confidence,
          });
        }
      });
    } catch (batchErr) {
      // Batch failed — fallback to individual calls. This protects against
      // safety blocks on one doc poisoning the whole batch.
      console.warn(
        `[batch-extract] batch failed (${batchErr instanceof Error ? batchErr.message.slice(0, 100) : "?"}), falling back to individual calls`
      );
      for (const p of itemsToOcr) {
        try {
          const result = await classifyAndExtract(
            p.item!.base64Data,
            p.item!.mimeType,
            { orgId: form.orgId },
            { skipPrevalidation: true }
          );
          resultByAttachmentId.set(p.attachment.id, {
            documentType: result.documentType,
            fields: result.fields,
            confidence: result.confidence,
          });
        } catch (err) {
          // Attach error to the prepared row; no entry added to the map so
          // the final loop emits the error response for this specific item
          // and the other items' results remain correctly associated.
          p.error = err instanceof Error ? err.message : String(err);
          // Release the OCR lock so the user can retry via single-extract.
          await prisma.formAttachment
            .update({
              where: { id: p.attachment.id },
              data: { extractingStartedAt: null },
            })
            .catch(() => {});
        }
      }
    }
  }

  // If the batch as a whole threw (not the fallback path — meaning batchErr
  // wasn't caught per-item), all claimed items also need their locks released.
  // But since we fall through to the fallback loop above, that's already
  // handled per-item. The only remaining case: full batch succeeded, individual
  // items may have results in the map. Those items' locks stay (harmless).

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
    const result = resultByAttachmentId.get(p.attachment.id);
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
