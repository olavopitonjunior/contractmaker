import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { runSingleJob, pollPortalJob } from "@/lib/certidoes/executor";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
// I.7 (2026-05-11) — TJSP com auth GOV.BR (login_cpf/login_senha) demora
// 3-10min na primeira chamada pedido-civel (Infosimples faz proxy login no
// e-SAJ). maxDuration de 120s era insuficiente — lambda morria silenciosamente
// e jobs ficavam zumbis em `fetching`. Alinha com POST /certidoes (660s).
export const maxDuration = 660;

const MAX_RETRIES = 3;
const STALE_AFTER_MS = 5 * 60_000; // 5 min

/**
 * POST /api/deals/:dealId/certidoes/:jobId/retry
 *
 * Handles retry of a single CertidaoJob. Behavior depends on current state:
 *
 *   - failed: resets to pending and calls runSingleJob (NEW API call, will cost)
 *   - fetching/pending (stuck >5 min): same as failed (container died)
 *   - awaiting_portal (expectedReadyAt passed or forced): calls pollPortalJob
 *     which uses the persisted numero_pedido — NO new pedido call, may or
 *     may not incur an obter-* call cost depending on endpoint pricing
 *   - success without attachment: re-downloads the receipt — ZERO cost
 *
 * Retries are capped at MAX_RETRIES via retryCount.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { dealId: string; jobId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const job = await prisma.certidaoJob.findUnique({
    where: { id: params.jobId },
    include: {
      deal: {
        include: {
          form: { select: { orgId: true } },
          // org via pipeline (form pode ser null em deal formless — IDOR)
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT (retry consome budget Infosimples).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (job.retryCount >= MAX_RETRIES) {
    return NextResponse.json(
      {
        error: `Limite de ${MAX_RETRIES} tentativas atingido. Delete o job ou resolva manualmente.`,
        retryCount: job.retryCount,
      },
      { status: 429 }
    );
  }

  // Classify the retry action
  const now = Date.now();
  const startedMs = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const isStuckFetching =
    (job.status === "fetching" || job.status === "pending") &&
    now - startedMs > STALE_AFTER_MS;

  // I.5 (2026-05-11) — `data_missing` e `failed_permanent` também passam por
  // re-execute. Antes só `failed`/stuck eram retentáveis pelo botão individual,
  // e UX mostrava CTA de retry em data_missing sem botão "Complementar" quando
  // missingFields vinha vazio do classifier. Agora o user pode tentar de novo
  // após corrigir o payload (via complement-data ou edição manual do deal).
  const canReExecute =
    job.status === "failed" ||
    job.status === "data_missing" ||
    job.status === "failed_permanent" ||
    isStuckFetching;
  const canPollPortal = job.status === "awaiting_portal";
  const canReAttach = job.status === "success" && !job.attachmentId;

  if (!canReExecute && !canPollPortal && !canReAttach) {
    return NextResponse.json(
      {
        error: `Job em estado ${job.status} nao pode ser retentado agora. Aguarde ou use o sweeper.`,
      },
      { status: 400 }
    );
  }

  // Branch: portal poll (reuses numero_pedido, no new pedido call)
  if (canPollPortal) {
    await prisma.certidaoJob.update({
      where: { id: params.jobId },
      data: { retryCount: { increment: 1 } },
    });
    waitUntil(
      pollPortalJob(params.jobId).catch((err) => {
        console.error("[certidoes] portal retry failed", err);
      })
    );
    return NextResponse.json({ ok: true, action: "poll_portal" }, { status: 202 });
  }

  // Branch: re-attach (re-download receipt of a successful job that failed to
  // persist its attachment). NO new API call.
  if (canReAttach) {
    const resultData = (job.resultData as Record<string, unknown>) ?? {};
    const receipt =
      (resultData._rawReceipt as string | undefined) ??
      (resultData.site_receipt as string | undefined);
    if (!receipt) {
      return NextResponse.json(
        { error: "Nao ha receipt salvo para re-baixar — re-execute o job" },
        { status: 400 }
      );
    }
    // Fire-and-forget wrapper: keeps existing success status but re-runs download
    waitUntil(
      runSingleJob(params.jobId, params.dealId).catch((err) => {
        console.error("[certidoes] re-attach failed", err);
      })
    );
    return NextResponse.json({ ok: true, action: "re_attach" }, { status: 202 });
  }

  // Branch: re-execute from scratch (failed or stuck). Will cost a new call.
  // IMPORTANT: clear stale resultData/resultCode/attachmentId so the card never
  // shows ghost data from a previous attempt while the new run is in progress.
  // This prevents the bug where status="fetching" + old resultData makes the
  // card display "Consultando" while the modal shows the stale "Negativa".
  await prisma.certidaoJob.update({
    where: { id: params.jobId },
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
      // attachmentId intentionally kept — the old PDF (if any) is still valid
      // and deleting the DealAttachment row separately is out of scope here.
    },
  });

  waitUntil(
    runSingleJob(params.jobId, params.dealId).catch((err) => {
      console.error("[certidoes] retry failed", err);
    })
  );

  return NextResponse.json({ ok: true, action: "re_execute" }, { status: 202 });
}
