import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { isIListEnvConfigured } from "@/lib/ilist/env";
import { syncOrgListings } from "@/lib/ilist/sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Full resync (reconcilia deletions) quando o último foi há mais de 7 dias.
const FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/ilist/sync-listings — delta-sync do espelho de listings de
 * todas as conexões iList habilitadas (a RexAPI não tem webhooks; schedule
 * de 6h no vercel.json + botão "Sincronizar agora" no admin pra urgência).
 * Erro em uma conexão não trava as demais (fica em lastSyncError).
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/ilist/sync-listings"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/ilist/sync-listings" });
  }
  if (!isIListEnvConfigured()) {
    return NextResponse.json({ skipped: "ilist-env-missing" });
  }

  const connections = await prisma.iListConnection.findMany({ where: { enabled: true } });
  const results: Array<{ orgId: string; ok: boolean; upserted?: number; error?: string }> = [];

  for (const conn of connections) {
    const full =
      !conn.lastFullSyncAt ||
      Date.now() - conn.lastFullSyncAt.getTime() > FULL_RESYNC_INTERVAL_MS;
    const res = await syncOrgListings(conn, { full });
    results.push({
      orgId: conn.orgId,
      ok: res.ok,
      upserted: res.upserted,
      ...(res.error ? { error: res.error.slice(0, 200) } : {}),
    });
  }

  return NextResponse.json({ connections: connections.length, results });
}
