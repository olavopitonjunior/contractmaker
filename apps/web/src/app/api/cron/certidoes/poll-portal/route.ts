import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { pollPortalJob, sweepStaleJobs } from "@/lib/certidoes/executor";

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
  const sweptCount = await sweepStaleJobs();

  return NextResponse.json({
    portal: {
      polled: portalJobs.length,
      success: portalSuccess,
      failed: portalFailed,
    },
    sweep: { swept: sweptCount },
  });
}
