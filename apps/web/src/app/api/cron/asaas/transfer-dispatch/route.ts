import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingTransfers } from "@/lib/locacao/transfer-dispatcher";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/asaas/transfer-dispatch
 *
 * Roda a cada 10min: pega AsaasTransfer status="PENDING_DISPATCH" (criados pelo
 * /api/locacao/repasses/realizar) e dispara via POST /v3/transfers do Asaas.
 * Atualiza status pra PENDING/DONE/FAILED + grava asaasTransferId.
 *
 * Auth: CRON_SECRET Bearer.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/asaas/transfer-dispatch"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/asaas/transfer-dispatch" });
  }

  const result = await dispatchPendingTransfers();

  return NextResponse.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}
