import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
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
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/asaas/transfer-dispatch"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/asaas/transfer-dispatch" });
  }

  const result = await dispatchPendingTransfers();

  return NextResponse.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}
