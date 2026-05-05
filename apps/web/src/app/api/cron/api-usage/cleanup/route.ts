import { NextRequest, NextResponse } from "next/server";
import { cleanupOldApiUsage } from "@/lib/api/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/api-usage/cleanup
 *
 * Diário (vercel.json `0 4 * * *`). Deleta `ApiUsage` > 90 dias.
 * Auth opcional via `CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const deleted = await cleanupOldApiUsage(90);
  return NextResponse.json({ deleted });
}
