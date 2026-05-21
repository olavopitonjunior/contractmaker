import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { matchDealGroup } from "@/lib/newton/group-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/newton-requests/group-match
 *
 * Sweep idempotente do auto-link deal↔grupo. Re-tenta o match nos deals SEM
 * `DealGroupLink` (recentes), pegando os casos onde a membership do grupo
 * amadureceu depois da criação (parte falou no grupo só agora) ou o deal nasceu
 * pela UI sem partes. `matchDealGroup` só grava em match forte; fraco fica pros
 * candidatos na UI.
 *
 * Schedule: horário (vercel.json). Auth: opcional via `CRON_SECRET`.
 */
const MAX_AGE_DAYS = 30;
const BATCH = 100;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const since = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const deals = await prisma.deal.findMany({
    where: { groupLink: { is: null }, createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: BATCH,
  });

  let linked = 0;
  for (const d of deals) {
    try {
      const r = await matchDealGroup(d.id);
      if (r.linked) linked++;
    } catch {
      /* best-effort por deal */
    }
  }

  return NextResponse.json({ scanned: deals.length, linked });
}
