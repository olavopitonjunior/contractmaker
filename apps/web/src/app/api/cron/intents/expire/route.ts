import { NextRequest, NextResponse } from "next/server";
import { expirePendingIntents } from "@/lib/api/intents";

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

  const expired = await expirePendingIntents();
  return NextResponse.json({ expired });
}
