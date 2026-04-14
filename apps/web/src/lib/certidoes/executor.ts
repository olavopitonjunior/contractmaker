import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { callInfosimples, downloadReceipt, InfosimplesError } from "./infosimples";
import { normalize } from "./normalizers";
import { endpointInfo } from "./endpoints";
import type { JobStatus } from "./types";

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
 */
export async function runBatch(batchId: string, dealId: string): Promise<void> {
  const jobs = await prisma.certidaoJob.findMany({
    where: { batchId, dealId, status: "pending" },
  });
  if (jobs.length === 0) return;

  const limit = pLimit(CONCURRENCY);
  await Promise.allSettled(jobs.map((j) => limit(() => runSingleJob(j.id, dealId))));
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
      const expected = new Date();
      // TJSP usually 5-15min; TJRJ up to 8 business days. Start polling after 1h for TJSP, 24h for TJRJ.
      expected.setTime(
        expected.getTime() +
          (job.endpoint.startsWith("tribunal/tjrj") ? 24 * 60 * 60_000 : 60 * 60_000)
      );
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
      attachmentId = await downloadAndAttach(dealId, job.endpoint, job.label, receipt);
    }

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: normalized as unknown as object,
        attachmentId,
        costCents: info.costCents,
      },
    });
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
    if (resp.code !== 200 && resp.code >= 600 && resp.code < 700) {
      const next = new Date();
      next.setTime(next.getTime() + 12 * 60 * 60_000);
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
        receipt
      );
    }

    await prisma.certidaoJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        finishedAt: new Date(),
        latencyMs,
        resultCode: resp.code,
        resultMessage: resp.code_message,
        resultData: normalized as unknown as object,
        attachmentId,
        costCents: (job.costCents ?? 0) + obterInfo.costCents,
      },
    });
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
  }
}

async function downloadAndAttach(
  dealId: string,
  endpoint: string,
  label: string,
  receiptUrl: string
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
 * Budget guard — returns current month spent and whether we are over budget.
 */
export async function getMonthlySpend(): Promise<{
  spentCents: number;
  budgetCents: number;
  exceeded: boolean;
}> {
  const budgetCents = Number(process.env.INFOSIMPLES_MONTHLY_BUDGET_CENTS ?? "5000");
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.certidaoJob.aggregate({
    where: { createdAt: { gte: firstOfMonth } },
    _sum: { costCents: true },
  });
  const spentCents = agg._sum.costCents ?? 0;
  return { spentCents, budgetCents, exceeded: spentCents >= budgetCents };
}

// Re-export for external callers
export { JobStatus };
