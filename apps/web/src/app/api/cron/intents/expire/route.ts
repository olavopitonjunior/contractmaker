import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { expirePendingIntents } from "@/lib/api/intents";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/intents/expire
 *
 * Marca como `expired` intents pendentes cujo `expiresAt` já passou (TTL 24h).
 * Schedule via vercel.json: `*&#47;10 * * * *`.
 *
 * Auth: opcional via `CRON_SECRET` em Authorization header.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/intents/expire"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/intents/expire" });
  }

  const expired = await expirePendingIntents();
  return NextResponse.json({ expired });
}
