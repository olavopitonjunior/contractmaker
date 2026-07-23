import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { syncEnvelopeState } from "@/lib/clicksign/sync";
import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
} from "@/lib/proposals/webhook-hooks";
import { sendVendedorEnvelope } from "@/lib/proposals/send-execute";
import { buildDossier } from "@/lib/proposals/dossier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PATH = "/api/cron/proposals/reconcile";

/**
 * Rede de segurança diária (07:00) pra propostas cujo webhook falhou/atrasou:
 *  1. Envelopes `running` (>2h sem update) → syncEnvelopeState contra a ClickSign;
 *     se remoto fechou/recusou, propaga pro status (que encadeia o 2º envelope).
 *  2. `aguardando_vendedor` SEM envelope reduzida vivo → redispara o 2º envelope
 *     (idempotente pelo @@unique + guard interno).
 *  3. `completa` sem `dossierUrl` → monta o dossiê.
 */
export async function GET(req: NextRequest) {
  const authErr = requireCronAuth(req);
  if (authErr) return authErr;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const result = { synced: 0, closedPropagated: 0, chainedRetried: 0, dossiersBuilt: 0, errors: 0 };

  // 1. Sincroniza envelopes running defasados.
  const envelopes = await prisma.envelope.findMany({
    where: {
      source: "proposal",
      status: "running",
      updatedAt: { lt: cutoff },
      clicksignId: { not: null },
    },
    include: { signers: true },
    take: 50,
  });
  for (const env of envelopes) {
    try {
      const r = await syncEnvelopeState(env, { actorVia: "cron-reconcile" });
      result.synced++;
      if (r.remoteStatus === "closed" || r.remoteStatus === "finished") {
        await onProposalEnvelopeClosed(env.id);
        result.closedPropagated++;
      } else if (r.remoteStatus === "canceled") {
        await onProposalEnvelopeRefused(env.id);
      }
    } catch {
      result.errors++;
    }
  }

  // 2. aguardando_vendedor sem reduzida viva → redispara.
  const stuck = await prisma.proposal.findMany({
    where: {
      status: "aguardando_vendedor",
      envelopes: { none: { via: "reduzida", status: { in: ["running", "closed"] } } },
    },
    select: { id: true },
    take: 50,
  });
  for (const p of stuck) {
    try {
      await sendVendedorEnvelope(p.id);
      result.chainedRetried++;
    } catch {
      result.errors++;
    }
  }

  // 3. completa sem dossiê → monta.
  const noDossier = await prisma.proposal.findMany({
    where: { status: "completa", dossierUrl: null },
    select: { id: true },
    take: 50,
  });
  for (const p of noDossier) {
    try {
      const r = await buildDossier(p.id);
      if ("url" in r) result.dossiersBuilt++;
    } catch {
      result.errors++;
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
