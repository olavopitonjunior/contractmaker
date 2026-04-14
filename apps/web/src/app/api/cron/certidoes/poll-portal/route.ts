import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { pollPortalJob } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/certidoes/poll-portal
 * Daily cron (Vercel Cron) — sweeps CertidaoJob rows in 'awaiting_portal' whose
 * expectedReadyAt has passed and tries the 'obter-*' counterpart endpoint.
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
  const jobs = await prisma.certidaoJob.findMany({
    where: {
      status: "awaiting_portal",
      expectedReadyAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let success = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await pollPortalJob(job.id);
      success++;
    } catch (err) {
      failed++;
      console.error("[cron] pollPortalJob failed", job.id, err);
    }
  }

  return NextResponse.json({ polled: jobs.length, success, failed });
}
