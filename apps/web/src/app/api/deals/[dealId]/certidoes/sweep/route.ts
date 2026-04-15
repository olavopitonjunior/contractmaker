import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { sweepStaleJobs } from "@/lib/certidoes/executor";

export const runtime = "nodejs";

/**
 * POST /api/deals/:dealId/certidoes/sweep
 * Manually runs the dead-man sweeper scoped to this deal. Useful when the
 * user sees zombie "fetching" jobs and does not want to wait for the cron.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Shorter threshold for manual sweep — 5 minutes — so user gets faster relief
  const swept = await sweepStaleJobs({
    dealId: params.dealId,
    staleAfterMs: 5 * 60_000,
  });

  return NextResponse.json({ swept });
}
