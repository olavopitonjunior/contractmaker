import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  classifyAndExtract,
  humanizeOcrError,
  prevalidateForOcr,
} from "@/lib/ai/ocr";
import { extractFirstPages } from "@/lib/ai/pdf-utils";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

/**
 * Phase F.I-α — Worker de OCR assíncrono.
 *
 * Pega até N attachments com `status="queued"`, processa em paralelo
 * (pLimit), atualiza status para ready|failed conforme resultado.
 *
 * Chamado de 2 lugares:
 *   1. Imediatamente após upload (fire-and-forget) — baixa latência p50
 *   2. Cron `/api/cron/ocr-queue` a cada 1min — backup pra órfãos
 *
 * Concorrência configurável via env:
 *   - OCR_WORKER_CONCURRENCY=3 (default free tier, 15 RPM Gemini)
 *   - Com paid tier pode subir para 10+
 */

const DEFAULT_CONCURRENCY = Number(process.env.OCR_WORKER_CONCURRENCY ?? "3");
const MAX_BATCH_PER_RUN = Number(process.env.OCR_WORKER_MAX_PER_RUN ?? "30");

function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length > 0) queue.shift()?.();
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            resolve(v);
            next();
          })
          .catch((e) => {
            reject(e);
            next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar blob`);
    return Buffer.from(await res.arrayBuffer());
  }
  return downloadBufferFromUrl(url);
}

interface WorkerResult {
  picked: number;
  succeeded: number;
  failed: number;
  cachedHits: number;
  durationMs: number;
}

/**
 * Processa a fila de OCR. Pega `MAX_BATCH_PER_RUN` attachments mais antigos
 * com status="queued" (ou status="extracting" com lock stale > 3min) e
 * processa em paralelo.
 *
 * Retorna estatísticas do run.
 */
export async function processOcrQueue(
  options: { formId?: string; orgId?: string } = {}
): Promise<WorkerResult> {
  const t0 = Date.now();
  const staleBefore = new Date(Date.now() - 3 * 60_000);

  // Claim lote via updateMany atomic + returning (duas queries — Prisma não
  // suporta RETURNING direto em updateMany no Postgres sem raw SQL).
  // Abordagem: findMany candidatos (take N) → updateMany por id IN.
  const candidates = await prisma.formAttachment.findMany({
    where: {
      ...(options.formId ? { formId: options.formId } : {}),
      ...(options.orgId ? { form: { orgId: options.orgId } } : {}),
      OR: [
        { status: "queued" },
        { status: "extracting", extractingStartedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH_PER_RUN,
    select: {
      id: true,
      mime: true,
      url: true,
      contentHash: true,
      form: { select: { orgId: true } },
    },
  });

  if (candidates.length === 0) {
    return { picked: 0, succeeded: 0, failed: 0, cachedHits: 0, durationMs: Date.now() - t0 };
  }

  // Claim: marca todos como extracting (idempotente — só os queued ou stale viram)
  const claimed = await prisma.formAttachment.updateMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
      OR: [
        { status: "queued" },
        { status: "extracting", extractingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "extracting",
      extractingStartedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    // Outro worker ganhou a corrida
    return { picked: 0, succeeded: 0, failed: 0, cachedHits: 0, durationMs: Date.now() - t0 };
  }

  // Re-fetch para pegar só os que efetivamente claimamos
  const toProcess = await prisma.formAttachment.findMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
      status: "extracting",
    },
    select: {
      id: true,
      mime: true,
      url: true,
      contentHash: true,
      form: { select: { orgId: true } },
    },
  });

  const limit = pLimit(DEFAULT_CONCURRENCY);
  let succeeded = 0;
  let failed = 0;
  let cachedHits = 0;

  await Promise.allSettled(
    toProcess.map((att) =>
      limit(async () => {
        const orgId = att.form?.orgId ?? "";
        try {
          // Content-hash cache check (cross-org: disabled for privacy; within
          // same org: habilitado)
          if (att.contentHash) {
            const cached = await prisma.formAttachment.findFirst({
              where: {
                id: { not: att.id },
                contentHash: att.contentHash,
                extractedData: { not: Prisma.JsonNull },
                status: "ready",
                form: { orgId },
              },
              select: { category: true, extractedData: true },
            });
            if (cached?.extractedData) {
              await prisma.formAttachment.update({
                where: { id: att.id },
                data: {
                  status: "ready",
                  category: cached.category,
                  extractedData: cached.extractedData as object,
                  extractingStartedAt: null,
                  extractError: null,
                },
              });
              cachedHits++;
              return;
            }
          }

          // Fetch buffer + validate + trim PDF
          let buffer = await fetchBuffer(att.url);
          const prevalidationError = prevalidateForOcr(buffer, att.mime);
          if (prevalidationError) {
            await prisma.formAttachment.update({
              where: { id: att.id },
              data: {
                status: "failed",
                extractError: prevalidationError,
                extractingStartedAt: null,
              },
            });
            failed++;
            return;
          }
          if (att.mime === "application/pdf") {
            const trimmed = await extractFirstPages(buffer, 2);
            if (trimmed.trimmed) buffer = trimmed.buffer;
          }

          // Call Gemini
          const result = await classifyAndExtract(
            buffer.toString("base64"),
            att.mime,
            { orgId },
            { buffer, skipPrevalidation: true }
          );

          await prisma.formAttachment.update({
            where: { id: att.id },
            data: {
              status: "ready",
              category: result.documentType,
              extractedData: {
                fields: result.fields,
                confidence: result.confidence,
              } as object,
              extractingStartedAt: null,
              extractError: null,
            },
          });
          succeeded++;
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          const friendly = humanizeOcrError(raw);
          await prisma.formAttachment.update({
            where: { id: att.id },
            data: {
              status: "failed",
              extractError: friendly,
              extractingStartedAt: null,
            },
          });
          failed++;
          console.error(`[ocr-worker] job ${att.id} failed:`, raw);
        }
      })
    )
  );

  const durationMs = Date.now() - t0;
  console.info(
    `[ocr-worker] run complete: picked=${toProcess.length} succeeded=${succeeded} failed=${failed} cachedHits=${cachedHits} durationMs=${durationMs}`
  );
  return {
    picked: toProcess.length,
    succeeded,
    failed,
    cachedHits,
    durationMs,
  };
}
