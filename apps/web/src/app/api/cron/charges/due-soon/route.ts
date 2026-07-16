import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { notifyChargeEvent } from "@/lib/financeiro/notifications";
import { isCronAllowedInStaging } from "@/lib/env/staging";

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
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/charges/due-soon"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/charges/due-soon" });
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
