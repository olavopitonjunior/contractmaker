import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { pollPortalJob, runSingleJob, sweepStaleJobs } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/certidoes/poll-portal
 * Hourly cron (Vercel Cron) — 2 tasks:
 *   1. Sweep CertidaoJob rows in 'awaiting_portal' whose expectedReadyAt has
 *      passed, call the 'obter-*' counterpart endpoint.
 *   2. Dead-man sweeper — mark as 'failed' any jobs stuck in 'fetching' or
 *      'pending' with startedAt (or createdAt) older than 15 minutes. These
 *      are zombies from containers that died mid-execution.
 * Auth: expects `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();

  // Task 1: portal poller
  const portalJobs = await prisma.certidaoJob.findMany({
    where: {
      status: "awaiting_portal",
      expectedReadyAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let portalSuccess = 0;
  let portalFailed = 0;
  for (const job of portalJobs) {
    try {
      await pollPortalJob(job.id);
      portalSuccess++;
    } catch (err) {
      portalFailed++;
      console.error("[cron] pollPortalJob failed", job.id, err);
    }
  }

  // Task 2: dead-man sweeper — stale jobs from crashed containers
  // Promotes zombies-with-valid-data to success, marks zombies-without-data as failed
  const sweepResult = await sweepStaleJobs();

  // Task 3 (J.4): retry automático de jobs em estado transitório.
  // `classifyOutcome` (J.3) agendou nextRetryAt baseado em categoria:
  //   - api_error: 30s, 2min, 10min
  //   - portal_unavailable: 10min, 30min, 2h
  //   - rate_limited: 30min, 1h
  // Esgotadas as tentativas, vira failed_permanent (transição feita pelo
  // próprio classifier no próximo runSingleJob).
  const retryJobs = await prisma.certidaoJob.findMany({
    where: {
      status: { in: ["api_error", "portal_unavailable", "rate_limited"] },
      nextRetryAt: { lte: now },
    },
    orderBy: { nextRetryAt: "asc" },
    take: 30,
    select: { id: true, dealId: true, retryCount: true },
  });
  let retrySuccess = 0;
  let retryFailed = 0;
  for (const job of retryJobs) {
    try {
      // Incrementa retryCount + reenfileira como pending para runSingleJob
      // começar do zero (inclui re-check de extracting lock).
      await prisma.certidaoJob.update({
        where: { id: job.id },
        data: {
          status: "pending",
          retryCount: { increment: 1 },
          nextRetryAt: null,
          startedAt: null,
        },
      });
      await runSingleJob(job.id, job.dealId);
      retrySuccess++;
    } catch (err) {
      retryFailed++;
      console.error("[cron] retry failed", job.id, err);
    }
  }

  return NextResponse.json({
    portal: {
      polled: portalJobs.length,
      success: portalSuccess,
      failed: portalFailed,
    },
    retry: {
      scheduled: retryJobs.length,
      success: retrySuccess,
      failed: retryFailed,
    },
    sweep: sweepResult,
  });
}
