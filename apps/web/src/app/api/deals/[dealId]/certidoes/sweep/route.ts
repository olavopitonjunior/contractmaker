import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { sweepStaleJobs } from "@/lib/certidoes/executor";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

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
    include: {
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  // Shorter threshold for manual sweep — 5 minutes — so user gets faster relief
  const result = await sweepStaleJobs({
    dealId: params.dealId,
    staleAfterMs: 5 * 60_000,
  });

  return NextResponse.json({
    promoted: result.promoted,
    requeued: result.requeued,
    failed: result.failed,
    swept: result.promoted + result.requeued + result.failed,
  });
}
