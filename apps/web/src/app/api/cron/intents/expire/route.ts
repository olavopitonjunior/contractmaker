import { NextRequest, NextResponse } from "next/server";
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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/intents/expire"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/intents/expire" });
  }

  const expired = await expirePendingIntents();
  return NextResponse.json({ expired });
}
