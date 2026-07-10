import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ClicksignError } from "@/lib/clicksign/client";
import { syncEnvelopeState } from "@/lib/clicksign/sync";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/clicksign/sync-envelopes
 * Fallback diário pra reconciliar envelopes "running" que não tiveram
 * webhook recente. Delega pro `syncEnvelopeState` — mesma reconciliação do
 * botão Atualizar: marca closed/canceled, baixa PDF, auto-promove deal E
 * reconcilia signatários (inclui `email_failed` de bounces, que a ClickSign
 * NUNCA manda por webhook — só no feed REST /events).
 *
 * Webhook cobre closed/sign em tempo real; este cron é o único caminho
 * automático pra surfacer bounces de e-mail sem ação do operador.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/clicksign/sync-envelopes"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/clicksign/sync-envelopes" });
  }

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h
  const envelopes = await prisma.envelope.findMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
      clicksignId: { not: null },
    },
    include: { signers: true },
    take: 50,
  });

  let synced = 0;
  let drifted = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const env of envelopes) {
    try {
      const result = await syncEnvelopeState(env, { actorVia: "cron" });
      const changed = result.envelopeUpdated || result.signersUpdated > 0;
      if (changed) {
        drifted += 1;
      } else {
        // Nada mudou: bump updatedAt pra não cair de novo no próximo sweep.
        await prisma.envelope.update({
          where: { id: env.id },
          data: { updatedAt: new Date() },
        });
      }
      synced += 1;
    } catch (err) {
      const msg = err instanceof ClicksignError ? err.message : String(err);
      errors.push({ id: env.id, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    examined: envelopes.length,
    synced,
    drifted,
    errorCount: errors.length,
    errors: errors.slice(0, 10),
  });
}
