import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { classifyAndExtract } from "@/lib/ai/ocr";

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

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes(" 429") ||
    lower.includes("resource_exhausted")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls classifyAndExtract with exponential backoff on rate-limit errors.
 * Waits 5s, 10s, 20s between attempts. Non-rate-limit errors fail fast.
 * Total worst case: ~35s of backoff on top of the actual Gemini latency.
 */
async function classifyWithRetry(
  base64: string,
  mimeType: string,
  ctx: { orgId: string }
): Promise<Awaited<ReturnType<typeof classifyAndExtract>>> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await classifyAndExtract(base64, mimeType, ctx);
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
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true, orgId: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachment = await prisma.formAttachment.findUnique({
    where: { id: params.id },
  });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (attachment.extractedData) {
    return NextResponse.json({
      cached: true,
      category: attachment.category,
      extractedData: attachment.extractedData,
    });
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

  try {
    const buffer = await fetchBuffer(attachment.url);
    const base64 = buffer.toString("base64");
    const result = await classifyWithRetry(base64, attachment.mime, {
      orgId: form.orgId,
    });

    const payload = {
      fields: result.fields,
      confidence: result.confidence,
    };

    await prisma.formAttachment.update({
      where: { id: attachment.id },
      data: {
        category: result.documentType,
        extractedData: payload as object,
      },
    });

    return NextResponse.json({
      cached: false,
      category: result.documentType,
      extractedData: payload,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[form extract] failed:", raw);
    return NextResponse.json(
      { error: humanizeExtractError(raw) },
      { status: 500 }
    );
  }
}

/**
 * Converts a raw Gemini/network error into a short user-friendly message.
 * The raw message often contains a nested JSON like
 *   "{"error":{"code":500,"message":"An internal error has occurred..."}}"
 * which is noise to the end user. This function picks a short diagnostic.
 */
function humanizeExtractError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("safety") || lower.includes("blocked")) {
    return "O documento foi bloqueado pelo filtro de segurança do OCR. Tente um arquivo diferente.";
  }
  if (
    lower.includes("invalid image") ||
    lower.includes("unsupported") ||
    lower.includes("decode")
  ) {
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
  // Last-resort fallback — strip anything that looks like JSON
  const clean = raw.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean.length < 200
    ? `Falha na extração: ${clean}`
    : "Falha na extração. Tente novamente ou use outro arquivo.";
}
