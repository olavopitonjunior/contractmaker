import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyChargeEvent } from "@/lib/financeiro/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/charges/due-soon
 *
 * Lembrete D-3: notifica owner do deal sobre cobranças PENDING que vencem
 * em ~3 dias. Idempotente via `Notification.@@unique([type, batchId])` —
 * batchId inclui data, então mesma cobrança 2 dias seguidos só notifica
 * uma vez (no D-3 exato).
 *
 * Schedule: diário 12:00 UTC (09:00 BRT) — vercel.json.
 *
 * Auth: opcional via `CRON_SECRET` em Authorization header (mesmo padrão
 * dos outros crons).
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);

  const charges = await prisma.commissionCharge.findMany({
    where: {
      status: "PENDING",
      currentDueDate: { gte: start, lte: end },
    },
    select: { id: true, orgId: true },
  });

  let notified = 0;
  for (const c of charges) {
    try {
      await notifyChargeEvent({
        chargeId: c.id,
        event: "due_soon",
        orgId: c.orgId,
      });
      notified++;
    } catch {
      /* notifyChargeEvent já trata internamente */
    }
  }

  return NextResponse.json({
    scanned: charges.length,
    notified,
    window: { start: start.toISOString(), end: end.toISOString() },
  });
}
