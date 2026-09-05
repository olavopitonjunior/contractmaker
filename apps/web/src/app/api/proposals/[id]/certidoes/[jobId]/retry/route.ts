import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { runSingleJob, pollPortalJob } from "@/lib/certidoes/executor";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";

export const runtime = "nodejs";
export const maxDuration = 660;

const MAX_RETRIES = 3;
const STALE_AFTER_MS = 5 * 60_000;

/**
 * POST /api/proposals/:id/certidoes/:jobId/retry — espelho do retry do Deal
 * para jobs de PROPOSTA: re-execução (custa), poll do portal (protocolo
 * salvo) ou re-anexo (zero custo). `runSingleJob(jobId, null)`: o escopo do
 * job é o próprio job.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; jobId: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const job = await prisma.certidaoJob.findUnique({ where: { id: params.jobId } });
  if (!job || job.proposalId !== scope.proposal.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.retryCount >= MAX_RETRIES) {
    return NextResponse.json(
      { error: `Limite de ${MAX_RETRIES} tentativas atingido. Delete o job ou resolva manualmente.`, retryCount: job.retryCount },
      { status: 429 }
    );
  }

  const now = Date.now();
  const startedMs = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const isStuckFetching =
    (job.status === "fetching" || job.status === "pending") && now - startedMs > STALE_AFTER_MS;
  const canReExecute =
    job.status === "failed" ||
    job.status === "data_missing" ||
    job.status === "failed_permanent" ||
    isStuckFetching;
  const canPollPortal = job.status === "awaiting_portal";
  // Job de proposta guarda o PDF em ProposalAttachment (attachmentId fica null):
  // "re-anexar" é quando não existe anexo ligado por certidaoJobId.
  const hasPdf = job.status === "success"
    ? (await prisma.proposalAttachment.count({ where: { certidaoJobId: job.id } })) > 0
    : true;
  const canReAttach = job.status === "success" && !hasPdf;

  if (!canReExecute && !canPollPortal && !canReAttach) {
    return NextResponse.json(
      { error: `Job em estado ${job.status} nao pode ser retentado agora. Aguarde ou use o sweeper.` },
      { status: 400 }
    );
  }

  if (canPollPortal) {
    await prisma.certidaoJob.update({ where: { id: job.id }, data: { retryCount: { increment: 1 } } });
    waitUntil(pollPortalJob(job.id).catch((err) => console.error("[certidoes] portal retry failed", err)));
    return NextResponse.json({ ok: true, action: "poll_portal" }, { status: 202 });
  }

  if (canReAttach) {
    const resultData = (job.resultData as Record<string, unknown>) ?? {};
    const receipt = (resultData._rawReceipt as string | undefined) ?? (resultData.site_receipt as string | undefined);
    if (!receipt) {
      return NextResponse.json({ error: "Nao ha receipt salvo para re-baixar — re-execute o job" }, { status: 400 });
    }
    waitUntil(runSingleJob(job.id, null).catch((err) => console.error("[certidoes] re-attach failed", err)));
    return NextResponse.json({ ok: true, action: "re_attach" }, { status: 202 });
  }

  await prisma.certidaoJob.update({
    where: { id: job.id },
    data: {
      status: "pending",
      errorMessage: null,
      retryCount: { increment: 1 },
      startedAt: null,
      finishedAt: null,
      resultCode: null,
      resultMessage: null,
      resultData: Prisma.DbNull,
      latencyMs: null,
    },
  });
  waitUntil(runSingleJob(job.id, null).catch((err) => console.error("[certidoes] retry failed", err)));
  return NextResponse.json({ ok: true, action: "re_execute" }, { status: 202 });
}
