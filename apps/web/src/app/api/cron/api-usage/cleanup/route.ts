import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { cleanupOldApiUsage } from "@/lib/api/usage";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/api-usage/cleanup
 *
 * Diário (vercel.json `0 4 * * *`). Deleta `ApiUsage` > 90 dias.
 * Auth opcional via `CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/api-usage/cleanup"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/api-usage/cleanup" });
  }

  const deleted = await cleanupOldApiUsage(90);
  return NextResponse.json({ deleted });
}
