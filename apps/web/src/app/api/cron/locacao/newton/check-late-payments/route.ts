import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { detectLatePaymentExecutor } from "@/lib/locacao/executors/detect-late-payment";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/locacao/newton/check-late-payments
 *
 * Cron diário 8h: pra cada RentCharge "pendente" cujo dueDate caiu há 3 dias
 * (window 3-4 dias pra pegar quem rodou ontem), dispara detect-late-payment.
 *
 * Dedupe interna (7d). Auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/locacao/newton/check-late-payments"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/locacao/newton/check-late-payments" });
  }

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600_000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 3600_000);

  const charges = await prisma.rentCharge.findMany({
    where: {
      status: { in: ["pendente", "emitida"] },
      dueDate: { lte: threeDaysAgo, gte: fourDaysAgo },
    },
    select: { id: true, orgId: true },
  });

  // Só processa orgs com o módulo "locacao" habilitado (gating por tenant).
  const distinctOrgIds = [...new Set(charges.map((c) => c.orgId))];
  const locacaoOrgs = new Set<string>();
  for (const orgId of distinctOrgIds) {
    if (isModuleEnabled(await getOrgModules(orgId), MODULE.LOCACAO)) {
      locacaoOrgs.add(orgId);
    }
  }

  const orgsWithUsers = new Map<string, string>();
  for (const c of charges) {
    if (!locacaoOrgs.has(c.orgId)) continue;
    if (orgsWithUsers.has(c.orgId)) continue;
    const m = await prisma.orgMembership.findFirst({
      where: { orgId: c.orgId, role: "owner" },
      select: { userId: true },
    });
    if (m) orgsWithUsers.set(c.orgId, m.userId);
  }

  let triggered = 0;
  let skipped = 0;
  for (const c of charges) {
    if (!locacaoOrgs.has(c.orgId)) {
      skipped++;
      continue;
    }
    const userId = orgsWithUsers.get(c.orgId);
    if (!userId) {
      skipped++;
      continue;
    }
    const r = await detectLatePaymentExecutor({
      rentChargeId: c.id,
      orgId: c.orgId,
      userId,
    });
    if (r.ok) triggered++;
    else skipped++;
  }

  return NextResponse.json({
    scanned: charges.length,
    triggered,
    skipped,
    timestamp: now.toISOString(),
  });
}
