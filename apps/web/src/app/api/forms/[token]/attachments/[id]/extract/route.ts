import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { classifyAndExtract, isRateLimitError, humanizeOcrError } from "@/lib/ai/ocr";
import { resolveFormScope, formLockedResponse } from "@/lib/forms/resolve-form-scope";
import { extractFirstPages, OCR_MAX_PAGES } from "@/lib/ai/pdf-utils";

async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ao baixar blob: ${url}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
  return downloadBufferFromUrl(url);
}

export const runtime = "nodejs";
// Must accommodate up to 3 retry attempts with backoff (5s + 10s + 20s = 35s)
// plus the actual Gemini call (~15-30s each) in the worst case.
export const maxDuration = 120;

const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls classifyAndExtract with exponential backoff on rate-limit errors.
 * Waits 5s, 10s, 20s between attempts. Non-rate-limit errors fail fast but
 * benefit from classifyAndExtract's built-in fallback model path.
 * Total worst case: ~35s of backoff on top of the actual Gemini latency.
 */
async function classifyWithRetry(
  base64: string,
  mimeType: string,
  buffer: Buffer,
  ctx: { orgId: string }
): Promise<Awaited<ReturnType<typeof classifyAndExtract>>> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await classifyAndExtract(base64, mimeType, ctx, {
        buffer,
        // fallback to flash-lite is automatic on non-rate-limit errors
      });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRateLimitError(msg) || attempt === MAX_RETRIES - 1) {
        throw err;
      }
      // Backoff: 5s, 10s, 20s — with a small jitter so parallel requests
      // don't synchronize and hit the API at the same instant.
      const base = 5000 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 2000);
      const waitMs = base + jitter;
      console.warn(
        `[form extract] rate limit — retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

const SUPPORTED_OCR_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  const scope = await resolveFormScope(params.token);
  if (!scope) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  const locked = formLockedResponse(scope);
  if (locked) return locked;
  const form = { id: scope.formId, orgId: scope.orgId };

  const attachment = await prisma.formAttachment.findUnique({
    where: { id: params.id },
  });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  // Subtoken só extrai os próprios anexos.
  if (scope.participantId && attachment.participantId !== scope.participantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (attachment.extractedData) {
    return NextResponse.json({
      cached: true,
      category: attachment.category,
      extractedData: attachment.extractedData,
    });
  }

  // Content hash cache: if another attachment in the same org already has
  // OCR results for the same file content (same SHA-256), reuse those results
  // instead of calling Gemini. Cross-form cache — scoped by orgId for privacy.
  if (attachment.contentHash) {
    const cached = await prisma.formAttachment.findFirst({
      where: {
        id: { not: attachment.id },
        contentHash: attachment.contentHash,
        extractedData: { not: Prisma.JsonNull },
        form: { orgId: form.orgId },
      },
      select: { category: true, extractedData: true },
      orderBy: { createdAt: "desc" },
    });
    if (cached && cached.extractedData) {
      await prisma.formAttachment.update({
        where: { id: attachment.id },
        data: {
          status: "ready",
          category: cached.category,
          extractedData: cached.extractedData as object,
          extractError: null,
        },
      });
      return NextResponse.json({
        cached: true,
        cacheSource: "content_hash",
        category: cached.category,
        extractedData: cached.extractedData,
      });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "OCR indisponivel: GEMINI_API_KEY nao configurada" },
      { status: 503 }
    );
  }

  if (!SUPPORTED_OCR_MIMES.includes(attachment.mime)) {
    return NextResponse.json(
      { error: `Tipo nao suportado para OCR: ${attachment.mime}` },
      { status: 400 }
    );
  }

  // Atomically claim this attachment for OCR. If another request is already
  // running Gemini for the same id, `updateMany` returns count=0 and we poll
  // for the result instead of issuing a duplicate Gemini call.
  // Stale-lock recovery: a lock older than LOCK_STALE_MS is considered dead
  // (worker crashed / timed out) and can be taken over.
  const LOCK_STALE_MS = 2 * 60 * 1000; // 2 minutes
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const claim = await prisma.formAttachment.updateMany({
    where: {
      id: attachment.id,
      extractedData: { equals: Prisma.DbNull },
      OR: [
        { extractingStartedAt: null },
        { extractingStartedAt: { lt: staleBefore } },
      ],
    },
    data: { extractingStartedAt: new Date() },
  });

  if (claim.count === 0) {
    // Another worker owns the lock — poll for up to 60s for it to finish.
    const POLL_INTERVAL_MS = 1500;
    const POLL_MAX_MS = 60 * 1000;
    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const fresh = await prisma.formAttachment.findUnique({
        where: { id: attachment.id },
        select: { category: true, extractedData: true, extractingStartedAt: true },
      });
      if (fresh?.extractedData) {
        return NextResponse.json({
          cached: true,
          cacheSource: "concurrent_extract",
          category: fresh.category,
          extractedData: fresh.extractedData,
        });
      }
      if (!fresh?.extractingStartedAt) {
        // Lock released without a result — the other worker failed. Break
        // out and attempt a fresh claim ourselves on the next iteration.
        break;
      }
    }
    return NextResponse.json(
      {
        error:
          "Extração concorrente em andamento — aguarde alguns segundos e tente novamente.",
      },
      { status: 409 }
    );
  }

  try {
    let buffer = await fetchBuffer(attachment.url);

    // PDF first-page trim: send only first 2 pages to Gemini to save tokens
    // on multi-page documents (procurações, escrituras). Transparent fallback
    // if pdf-lib fails.
    if (attachment.mime === "application/pdf") {
      const trimmed = await extractFirstPages(buffer, OCR_MAX_PAGES);
      if (trimmed.trimmed) {
        console.log(
          `[form extract] trimmed PDF ${attachment.id}: ${trimmed.totalPages} → ${trimmed.pagesKept} páginas`
        );
        buffer = trimmed.buffer;
      }
    }

    const base64 = buffer.toString("base64");
    const result = await classifyWithRetry(base64, attachment.mime, buffer, {
      orgId: form.orgId,
    });

    const payload = {
      fields: result.fields,
      confidence: result.confidence,
    };

    await prisma.formAttachment.update({
      where: { id: attachment.id },
      data: {
        status: "ready",
        category: result.documentType,
        extractedData: payload as object,
        extractError: null,
        // Leave extractingStartedAt set — it's a no-op now that extractedData
        // is non-null (the claim guard requires extractedData: null).
      },
    });

    return NextResponse.json({
      cached: false,
      category: result.documentType,
      extractedData: payload,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const friendly = humanizeExtractError(raw);
    // Marca como failed + libera lock pra retry. Antes ficava no status
    // anterior ("queued"/"awaiting_user") sem feedback — UI mostrava
    // skeleton eterno. Agora vira "failed" com mensagem clara + botão
    // "Tentar novamente" no card.
    await prisma.formAttachment
      .update({
        where: { id: attachment.id },
        data: {
          status: "failed",
          extractError: friendly,
          extractingStartedAt: null,
        },
      })
      .catch((releaseErr) => {
        console.warn(
          "[form extract] failed to release lock:",
          releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
        );
      });
    console.error("[form extract] failed:", raw);
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

// Phase F.IV — humanizeExtractError movido para lib/ai/ocr.ts (humanizeOcrError)
// para evitar duplicação entre single e batch extract routes. Uso direto daqui.
const humanizeExtractError = humanizeOcrError;
