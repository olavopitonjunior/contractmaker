import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  classifyAndExtract,
  humanizeOcrError,
  prevalidateForOcr,
} from "@/lib/ai/ocr";
import { isRateLimitError } from "@/lib/ai/ocr";
import { extractFirstPages, OCR_MAX_PAGES } from "@/lib/ai/pdf-utils";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Concorrência configurável via env. Matriz recomendada:
 *
 *   | Tier Gemini       | RPM   | CONCURRENCY | PACE_MS |
 *   |-------------------|-------|-------------|---------|
 *   | Free (default)    | 15    | 1           | 4000    |
 *   | Tier 1 ($5 gasto) | 1000  | 5           | 0       |
 *   | Tier 2 ($250)     | 10000 | 10          | 0       |
 *
 * Para 20 docs/form rotineiro (nosso cenário), Tier 1 + CONCURRENCY=5 +
 * PACE_MS=0 entrega em ~30-60s. Setar Vercel env vars do projeto.
 */

// Free tier Gemini: 15 RPM. Concurrency 1 + 4s spacing ≈ 15 req/min segura.
// Paid tier (>$5 gasto → Tier 1 1000 RPM): OCR_WORKER_CONCURRENCY=5 + PACE_MS=0
const DEFAULT_CONCURRENCY = Number(process.env.OCR_WORKER_CONCURRENCY ?? "1");
const MAX_BATCH_PER_RUN = Number(process.env.OCR_WORKER_MAX_PER_RUN ?? "30");
// Pace entre chamadas quando em concurrency=1 (4s ≈ 15 RPM free tier).
// Com concurrency > 1, ignorado (assume paid tier com limits altos).
const PACE_MS = Number(process.env.OCR_WORKER_PACE_MS ?? "4000");
// Pausa geral do worker quando qualquer call hits rate-limit (Gemini reseta
// quota a cada ~60s). Evita retries acumulados estourando de novo.
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.OCR_WORKER_RATE_COOLDOWN_MS ?? "65000");

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
  // Stale recovery mais agressivo: 90s é tempo suficiente para Gemini
  // responder. Passou disso, assume crash do worker e reclaima.
  const STALE_MS = Number(process.env.OCR_STALE_MS ?? "90000");
  const staleBefore = new Date(Date.now() - STALE_MS);

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
  let lastCallAt = 0;
  // Quando um call bate rate-limit, o worker inteiro pausa por 65s (quota
  // reseta a cada 60s). Após 2 rate-limits consecutivos, aborta o loop e
  // deixa os restantes como "queued" pro próximo run do cron.
  let rateLimitHits = 0;
  let aborted = false;

  // Em concurrency=1 com pace, reprocessa sequencialmente com espaçamento
  // entre calls. Com concurrency > 1 (paid tier), usa allSettled normal.
  const useSequentialPace = DEFAULT_CONCURRENCY === 1;

  const processOne = async (att: (typeof toProcess)[number]): Promise<void> => {
    if (aborted) {
      // Não processa mais — libera lock para próximo run pegar
      await prisma.formAttachment
        .update({
          where: { id: att.id },
          data: { status: "queued", extractingStartedAt: null },
        })
        .catch(() => {});
      return;
    }

    const orgId = att.form?.orgId ?? "";
    try {
      // Content-hash cache check (intra-org)
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

      // Pace — garante espaçamento mínimo entre chamadas Gemini quando
      // em concurrency=1 (free tier). Sem custo se já passou o intervalo.
      if (useSequentialPace && lastCallAt > 0) {
        const elapsed = Date.now() - lastCallAt;
        if (elapsed < PACE_MS) {
          await sleep(PACE_MS - elapsed);
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
        const trimmed = await extractFirstPages(buffer, OCR_MAX_PAGES);
        if (trimmed.trimmed) buffer = trimmed.buffer;
      }

      lastCallAt = Date.now();
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
      rateLimitHits = 0; // reset — sinal que quota voltou
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);

      if (isRateLimitError(raw)) {
        rateLimitHits++;
        console.warn(
          `[ocr-worker] rate limit hit (${rateLimitHits}), cooling down ${RATE_LIMIT_COOLDOWN_MS}ms`
        );
        // Libera o lock — job volta pra queued pro próximo run
        await prisma.formAttachment
          .update({
            where: { id: att.id },
            data: { status: "queued", extractingStartedAt: null },
          })
          .catch(() => {});

        if (rateLimitHits >= 2) {
          // Duas batidas = quota insuficiente. Aborta para cron pegar depois.
          aborted = true;
          console.warn(
            "[ocr-worker] 2 rate limits consecutivos — abortando run, cron pega em 1 min"
          );
          return;
        }

        // Cooldown global antes de próximo call
        await sleep(RATE_LIMIT_COOLDOWN_MS);
        lastCallAt = 0; // força pace reset
        return;
      }

      // Erro não-rate-limit: marca failed com mensagem humanizada
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
  };

  if (useSequentialPace) {
    // Loop sequencial — respeita pace + cooldown. Mais lento mas seguro.
    for (const att of toProcess) {
      await processOne(att);
      if (aborted) break;
    }
    // Rows restantes (se aborted) volta pra queued — condicional em
    // status="extracting" garante que só afeta os ainda não processados
    if (aborted) {
      await prisma.formAttachment
        .updateMany({
          where: {
            id: { in: toProcess.map((a) => a.id) },
            status: "extracting",
          },
          data: { status: "queued", extractingStartedAt: null },
        })
        .catch(() => {});
    }
  } else {
    // Concurrency > 1 (paid tier): paralelo clássico
    await Promise.allSettled(toProcess.map((att) => limit(() => processOne(att))));
  }

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
