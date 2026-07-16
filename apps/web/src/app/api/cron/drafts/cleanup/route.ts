import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/drafts/cleanup
 * Deleta CommissionChargeDraft com expiresAt < now. Schedule diário 03:00 UTC.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/drafts/cleanup"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/drafts/cleanup" });
  }

  const result = await prisma.commissionChargeDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return NextResponse.json({ deleted: result.count });
}
