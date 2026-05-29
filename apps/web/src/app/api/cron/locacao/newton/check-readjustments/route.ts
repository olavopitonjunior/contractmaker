import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { suggestReadjustmentExecutor } from "@/lib/locacao/executors/suggest-readjustment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/locacao/newton/check-readjustments
 *
 * Cron diário 9h: pra cada LeaseContract ativo com `dataProximoReajuste`
 * caindo nos próximos 60 dias, dispara suggest-readjustment executor (Newton
 * avisa operador via WhatsApp).
 *
 * Dedupe interna do executor (30d). Auth via CRON_SECRET Bearer.
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
  const in60d = new Date(now.getTime() + 60 * 24 * 3600_000);

  const leases = await prisma.leaseContract.findMany({
    where: {
      status: "ativo",
      dataProximoReajuste: { gte: now, lte: in60d },
    },
    select: { id: true, orgId: true },
  });

  // Pega 1 user owner por org (executor precisa de userId pra audit).
  const orgsWithUsers = new Map<string, string>();
  for (const lc of leases) {
    if (orgsWithUsers.has(lc.orgId)) continue;
    const m = await prisma.orgMembership.findFirst({
      where: { orgId: lc.orgId, role: "owner" },
      select: { userId: true },
    });
    if (m) orgsWithUsers.set(lc.orgId, m.userId);
  }

  let triggered = 0;
  let skipped = 0;
  for (const lc of leases) {
    const userId = orgsWithUsers.get(lc.orgId);
    if (!userId) {
      skipped++;
      continue;
    }
    const r = await suggestReadjustmentExecutor({
      leaseContractId: lc.id,
      orgId: lc.orgId,
      userId,
    });
    if (r.ok) triggered++;
    else skipped++;
  }

  return NextResponse.json({
    scanned: leases.length,
    triggered,
    skipped,
    timestamp: now.toISOString(),
  });
}
