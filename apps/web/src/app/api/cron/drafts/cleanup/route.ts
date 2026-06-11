import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/drafts/cleanup
 * Deleta CommissionChargeDraft com expiresAt < now. Schedule diário 03:00 UTC.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/drafts/cleanup"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/drafts/cleanup" });
  }

  const result = await prisma.commissionChargeDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return NextResponse.json({ deleted: result.count });
}
