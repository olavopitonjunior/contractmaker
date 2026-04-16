import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { callInfosimples, downloadReceipt, InfosimplesError } from "./infosimples";
import { normalize } from "./normalizers";
import { endpointInfo } from "./endpoints";
import type { JobStatus } from "./types";
import { emitNotification } from "@/lib/notifications/emit";

// F4 — terminal states for a job. `awaiting_portal` is NOT terminal for
// notification purposes (user will get notified when it completes in the
// portal poller). Replaced jobs are ignored entirely.
const TERMINAL_FOR_NOTIFICATION = new Set<string>([
  "success",
  "failed",
  "skipped",
]);

/**
 * F4 — Adaptive retry delay for awaiting_portal jobs.
 *
 *   - TJSP: normally ready in 5-15min, so poll aggressively in the first 2h
 *     (every 30min), then back off to every 2h after that.
 *   - TJRJ: can take up to 8 business days, so poll every 6h in the first
 *     48h, then every 24h.
 *
 * Returns the milliseconds delta to add to `expectedReadyAt`.
 */
function computeAdaptiveRetryDelta(
  endpoint: string,
  createdAt: Date
): number {
  const ageMs = Date.now() - createdAt.getTime();
  const twoHoursMs = 2 * 60 * 60_000;
  const fortyEightHoursMs = 48 * 60 * 60_000;
  if (endpoint.includes("/tjsp/")) {
    return ageMs < twoHoursMs ? 30 * 60_000 : 2 * 60 * 60_000;
  }
  if (endpoint.includes("/tjrj/")) {
    return ageMs < fortyEightHoursMs ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
  }
  // Unknown portal type — fall back to the old fixed 12h
  return 12 * 60 * 60_000;
}

/**
 * F4 — Computes the initial `expectedReadyAt` for a freshly-submitted
 * two-step portal job. TJSP is polled first at 30min, TJRJ at 6h.
 */
function computeInitialExpectedReadyAt(endpoint: string): Date {
  const expected = new Date();
  if (endpoint.includes("/tjsp/")) {
    expected.setTime(expected.getTime() + 30 * 60_000); // 30 min
  } else if (endpoint.includes("/tjrj/")) {
    expected.setTime(expected.getTime() + 6 * 60 * 60_000); // 6h
  } else {
    expected.setTime(expected.getTime() + 60 * 60_000); // 1h default
  }
  return expected;
}

/**
 * F4 — Emits a `certidao_batch_complete` notification when ALL non-replaced
 * jobs in a batch reach a terminal state. Uses `metadata.batchId` for
 * idempotency — if a notification was already emitted for this batch, this
 * is a no-op. Fire-and-forget: never throws.
 *
 * For single-job batches (retries, complementar, cherry-picks), emits a
 * more specific `certidao_ready` title instead of the aggregated one.
 */
async function checkBatchCompletion(batchId: string): Promise<void> {
  try {
    // Idempotency: skip if already notified
    const existing = await prisma.notification.findFirst({
      where: {
        type: "certidao_batch_complete",
        metadata: { path: ["batchId"], equals: batchId },
      },
      select: { id: true },
    });
    if (existing) return;

    const jobs = await prisma.certidaoJob.findMany({
      where: { batchId, status: { not: "replaced" } },
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            form: { select: { orgId: true } },
          },
        },
      },
    });
    if (jobs.length === 0) return;

    // If ANY job is still non-terminal, bail — we'll try again later.
    const pendingCount = jobs.filter(
      (j) => !TERMINAL_FOR_NOTIFICATION.has(j.status)
    ).length;
    if (pendingCount > 0) return;

    // All terminal — emit the notification
    const first = jobs[0];
    if (!first.deal.form?.orgId) return; // needs org to scope notifications

    const success = jobs.filter((j) => j.status === "success").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    const skipped = jobs.filter((j) => j.status === "skipped").length;
    const positivas = jobs.filter((j) => {
      if (j.status !== "success") return false;
      const r = j.resultData as { situacao?: string } | null;
      return r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos";
    }).length;

    const dealTitle = first.deal.title;
    const userId = first.userId;

    // Single-job batches: more specific notification
    if (jobs.length === 1) {
      const job = first;
      const situacao = (job.resultData as { situacao?: string } | null)?.situacao;
      const title =
        job.status === "success"
          ? `Certidão pronta: ${job.label}`
          : job.status === "failed"
          ? `Certidão falhou: ${job.label}`
          : `Certidão pulada: ${job.label}`;
      const body = situacao
        ? `${situacao} — ${dealTitle}`
        : job.errorMessage
        ? `${job.errorMessage.slice(0, 100)} — ${dealTitle}`
        : dealTitle;
      await emitNotification({
        orgId: first.deal.form.orgId,
        userId,
        type: "certidao_batch_complete", // still use batch type for idempotency
        title,
        body,
        linkUrl: `/deals/${first.deal.id}`,
        metadata: { batchId, dealId: first.deal.id, jobId: job.id },
      });
      return;
    }

    // Multi-job batch: aggregated title + breakdown body
    const parts: string[] = [];
    if (success > 0) parts.push(`${success} ✓`);
    if (positivas > 0) parts.push(`${positivas} positiva(s)`);
    if (failed > 0) parts.push(`${failed} falha(s)`);
    if (skipped > 0) parts.push(`${skipped} pulada(s)`);
    const breakdown = parts.join(" · ");

    await emitNotification({
      orgId: first.deal.form.orgId,
      userId,
      type: "certidao_batch_complete",
      title: `Batch de ${jobs.length} certidões concluído`,
      body: `${breakdown} — ${dealTitle}`,
      linkUrl: `/deals/${first.deal.id}`,
      metadata: { batchId, dealId: first.deal.id },
    });
  } catch (err) {
    console.error(
      "[checkBatchCompletion] failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

const CONCURRENCY = 5;

/**
 * Minimal p-limit inline implementation.
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length > 0) {
      const fn = queue.shift();
      fn?.();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
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
  };
}

/**
 * Execute all jobs in a batch. Updates each CertidaoJob row as it progresses.
 * Designed to be called in fire-and-forget fashion from the route handler.
 *
 * F4: after all jobs in the batch reach a terminal state (for fast federal
 * endpoints that complete synchronously), emits a notification via
 * `checkBatchCompletion`. For batches with two-step portals, the final
 * completion check happens later in `pollPortalJob` when the last portal
 * job transitions to success/failed.
 */
export async function runBatch(batchId: string, dealId: string): Promise<void> {
  const jobs = await prisma.certidaoJob.findMany({
    where: { batchId, dealId, status: "pending" },
  });
  if (jobs.length === 0) return;

  const limit = pLimit(CONCURRENCY);
  await Promise.allSettled(jobs.map((j) => limit(() => runSingleJob(j.id, dealId))));

  // F4: check if the batch is fully done and emit notification
  await checkBatchCompletion(batchId);
}

/**
 * Run a single job: call Infosimples, normalize, download receipt, link to attachment.
 * Handles two-step portals (TJSP/TJRJ) by transitioning to awaiting_portal.
 */
export async function runSingleJob(jobId: string, dealId: string): Promise<void> {
  const job = await prisma.certidaoJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const startedAt = new Date();
  await prisma.certidaoJob.update({
    where: { id: jobId },
    data: { status: "fetching", startedAt, retryCount: { increment: 0 } },
  });

  const info = endpointInfo(job.endpoint);

  try {
    const args = job.requestPayload as Record<string, unknown>;
    const resp = await callInfosimples(job.endpoint, args);
    const latencyMs = Date.now() - startedAt.getTime();

    // Two-step portal: the pedido call returns numero_pedido; mark as awaiting.
    const isPedido = info.twoStep === true;
    if (isPedido && resp.code === 200) {
      const d = (resp.data?.[0] as Record<string, unknown>) ?? {};
      const numeroPedido =
        (d.numero_pedido as string) ?? (d.numero_requerimento as string) ?? null;
      // F4: adaptive initial delay — TJSP 30min (normally ready in 5-15min),
      // TJRJ 6h (up to 8 business days). Previously fixed 1h / 24h.
      const expected = computeInitialExpectedReadyAt(job.endpoint);
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: {
          status: "awaiting_portal",
          latencyMs,
          resultCode: resp.code,
          resultMessage: resp.code_message,
          resultData: { numero_pedido: numeroPedido, initial: true },
          expectedReadyAt: expected,
          costCents: info.costCents,
        },
      });
      return;
    }

    // Single-step or failed pedido: normalize + attach PDF (if any).
    const normalized = normalize(job.endpoint, resp);
    let attachmentId: string | null = null;
    const receipt = resp.site_receipts?.[0];
    if (receipt && resp.code === 200) {
      attachmentId = await downloadAndAttach(
        dealId,
        job.endpoint,
        job.label,
        receipt,
        job.targetKind,
        job.targetIndex
      );
    }

    // Persist the raw receipt URL alongside normalized data so retry's
    // "re_attach" branch can re-download without a new API call.
    const enrichedResultData: Record<string, unknown> = {
      ...(normalized as unknown as Record<string, unknown>),
    };
    if (receipt) enrichedResultData._rawReceipt = receipt;

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: enrichedResultData as object,
        attachmentId,
        costCents: info.costCents,
      },
    });
    // F4: single-job path (retry/complementar) — check batch. For multi-job
    // batches from runBatch this is also called but is idempotent via batchId
    // metadata lookup.
    await checkBatchCompletion(job.batchId);
  } catch (err) {
    const latencyMs = Date.now() - startedAt.getTime();
    const message =
      err instanceof InfosimplesError
        ? `${err.message}`
        : err instanceof Error
        ? err.message
        : "erro desconhecido";
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        latencyMs,
        errorMessage: message.slice(0, 500),
        costCents: info.costCents,
      },
    });
    await checkBatchCompletion(job.batchId);
  }
}

/**
 * Polls a single awaiting_portal job by calling the 'obter' counterpart.
 * Designed for the daily cron that sweeps TJSP/TJRJ jobs.
 */
export async function pollPortalJob(jobId: string): Promise<void> {
  const job = await prisma.certidaoJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "awaiting_portal") return;

  const pedidoData = (job.resultData as Record<string, unknown>) ?? {};
  const numeroPedido = pedidoData.numero_pedido as string | undefined;
  if (!numeroPedido) {
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "numero_pedido ausente no job pedido",
      },
    });
    return;
  }

  const obterEndpoint = job.endpoint.includes("/tjsp/")
    ? "tribunal/tjsp/obter-civel"
    : job.endpoint.includes("/tjrj/")
    ? "tribunal/tjrj/obter-certidao"
    : null;
  if (!obterEndpoint) return;

  const obterInfo = endpointInfo(obterEndpoint);
  const startedAt = new Date();

  try {
    const resp = await callInfosimples(obterEndpoint, {
      numero_pedido: numeroPedido,
    });
    const latencyMs = Date.now() - startedAt.getTime();

    // If not ready yet (business code indicating pending), push expectedReadyAt forward.
    // F4: adaptive delay based on portal type + age — TJSP polls every 30min
    // in the first 2h, TJRJ every 6h in the first 48h. Previously fixed 12h.
    if (resp.code !== 200 && resp.code >= 600 && resp.code < 700) {
      const next = new Date();
      next.setTime(next.getTime() + computeAdaptiveRetryDelta(job.endpoint, job.createdAt));
      const MAX_AGE = 14 * 24 * 60 * 60_000;
      const tooOld = startedAt.getTime() - job.createdAt.getTime() > MAX_AGE;
      await prisma.certidaoJob.update({
        where: { id: jobId },
        data: tooOld
          ? {
              status: "failed",
              finishedAt: new Date(),
              errorMessage: `Timeout portal: ${resp.code_message}`,
              costCents: (job.costCents ?? 0) + obterInfo.costCents,
            }
          : {
              expectedReadyAt: next,
              resultMessage: resp.code_message,
              costCents: (job.costCents ?? 0) + obterInfo.costCents,
            },
      });
      // F4: if tooOld, the job just went terminal — check batch completion
      if (tooOld) {
        await checkBatchCompletion(job.batchId);
      }
      return;
    }

    const normalized = normalize(obterEndpoint, resp);
    let attachmentId: string | null = null;
    const receipt = resp.site_receipts?.[0];
    if (receipt && resp.code === 200) {
      attachmentId = await downloadAndAttach(
        job.dealId,
        obterEndpoint,
        job.label,
        receipt,
        job.targetKind,
        job.targetIndex
      );
    }

    const enrichedObterData: Record<string, unknown> = {
      ...(normalized as unknown as Record<string, unknown>),
    };
    if (receipt) enrichedObterData._rawReceipt = receipt;

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: enrichedObterData as object,
        attachmentId,
        costCents: (job.costCents ?? 0) + obterInfo.costCents,
      },
    });
    // F4: portal job just became terminal — check if the whole batch is done
    await checkBatchCompletion(job.batchId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 500),
      },
    });
    // F4: failure is also a terminal state — check batch
    await checkBatchCompletion(job.batchId);
  }
}

async function downloadAndAttach(
  dealId: string,
  endpoint: string,
  label: string,
  receiptUrl: string,
  targetKind: string,
  targetIndex: number
): Promise<string | null> {
  try {
    const { buffer, contentType } = await downloadReceipt(receiptUrl);
    const safeName = `${endpoint.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.pdf`;
    const bucket = process.env.S3_BUCKET;
    const key = `deal-certidoes/${dealId}/${safeName}`;
    const url = await uploadBufferToStorage({
      bucket,
      key,
      body: buffer,
      contentType,
    });
    // Persist assignment so DocumentsTab groups certidao attachments by part/imovel
    const assignmentKind =
      targetKind === "vendedor" || targetKind === "comprador" || targetKind === "imovel"
        ? targetKind
        : "outro";
    const attachment = await prisma.dealAttachment.create({
      data: {
        dealId,
        filename: safeName,
        mime: contentType,
        url,
        category: "certidao",
        source: "infosimples",
        extractedData: {
          certidao: { endpoint, label },
          assignment: { kind: assignmentKind, index: targetIndex },
        },
      },
    });
    return attachment.id;
  } catch (err) {
    console.error("[certidoes] falha ao baixar comprovante", err);
    return null;
  }
}

/**
 * Dead-man sweeper — resolves jobs stuck in non-terminal states when their
 * container has clearly died (started more than `staleAfterMs` ago).
 *
 * CRITICAL: this function never overwrites a valid result. If the sweeper
 * finds a zombie job that has already persisted valid result data (resultCode
 * 200 + resultData.situacao in a terminal state), it PROMOTES the job to
 * status="success" instead of marking as failed. This protects against the
 * race where the container finished the Prisma update for resultData but died
 * before returning HTTP to the polling client — the data is in the DB, the
 * job row just looks stuck.
 *
 * Runs hourly via cron. Also exposed via /api/deals/:id/certidoes/sweep for
 * per-deal manual sweeps.
 *
 * Returns `{ promoted, failed }` counts.
 */
export async function sweepStaleJobs(options: {
  dealId?: string;
  staleAfterMs?: number;
} = {}): Promise<{ promoted: number; failed: number }> {
  const staleAfter = options.staleAfterMs ?? 15 * 60_000; // 15 min default
  const cutoff = new Date(Date.now() - staleAfter);

  const stale = await prisma.certidaoJob.findMany({
    where: {
      ...(options.dealId ? { dealId: options.dealId } : {}),
      status: { in: ["fetching", "pending"] },
      OR: [
        { startedAt: { lt: cutoff } },
        { AND: [{ startedAt: null }, { createdAt: { lt: cutoff } }] },
      ],
    },
    select: {
      id: true,
      batchId: true,
      resultCode: true,
      resultData: true,
      attachmentId: true,
    },
  });

  if (stale.length === 0) return { promoted: 0, failed: 0 };

  const TERMINAL_SITUACOES = new Set([
    "negativa",
    "positiva",
    "positiva_com_efeitos",
    "nao_emitida",
    "aguardando_pdf",
  ]);

  const toPromote: string[] = [];
  const toFail: string[] = [];

  for (const job of stale) {
    const data = job.resultData as { situacao?: string } | null;
    const hasValidResult =
      job.resultCode === 200 &&
      data != null &&
      typeof data.situacao === "string" &&
      TERMINAL_SITUACOES.has(data.situacao);
    if (hasValidResult) {
      toPromote.push(job.id);
    } else {
      toFail.push(job.id);
    }
  }

  const now = new Date();

  if (toPromote.length > 0) {
    await prisma.certidaoJob.updateMany({
      where: { id: { in: toPromote } },
      data: {
        status: "success",
        finishedAt: now,
      },
    });
  }

  if (toFail.length > 0) {
    await prisma.certidaoJob.updateMany({
      where: { id: { in: toFail } },
      data: {
        status: "failed",
        finishedAt: now,
        errorMessage:
          "Timeout — container reciclado antes de concluir a consulta. Clique em tentar novamente.",
      },
    });
  }

  // F4: check batch completion for every unique batch touched by the sweep
  const touchedBatchIds = Array.from(new Set(stale.map((j) => j.batchId)));
  for (const batchId of touchedBatchIds) {
    await checkBatchCompletion(batchId);
  }

  return { promoted: toPromote.length, failed: toFail.length };
}

/**
 * Budget guard — returns current month spent for the given org and whether we
 * are over budget. Budget is per-org to isolate tenants — one org's spend does
 * not consume another org's quota.
 */
export async function getMonthlySpend(orgId: string): Promise<{
  spentCents: number;
  budgetCents: number;
  exceeded: boolean;
}> {
  const budgetCents = Number(process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS ?? "5000");
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.certidaoJob.aggregate({
    where: {
      createdAt: { gte: firstOfMonth },
      deal: { form: { orgId } },
    },
    _sum: { costCents: true },
  });
  const spentCents = agg._sum.costCents ?? 0;
  return { spentCents, budgetCents, exceeded: spentCents >= budgetCents };
}

// Re-export for external callers
export { JobStatus };
