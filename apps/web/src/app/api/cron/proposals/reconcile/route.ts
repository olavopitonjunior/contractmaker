import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { syncEnvelopeState } from "@/lib/clicksign/sync";
import { sendVendedorEnvelope, recoverOrphanClaim } from "@/lib/proposals/send-execute";
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
 *  4. Claim órfão: `enviada` sem `sentAt` e sem envelope vivo (>30min) → o envio
 *     foi morto no meio (timeout) depois do claim CAS; sem isto a proposta trava
 *     pra sempre ("já foi enviada" no /send, "ninguém pendente" no /remind).
 *     Libera pra `falha_envio` (reenviável) + ProposalEvent.
 */
export async function GET(req: NextRequest) {
  const authErr = requireCronAuth(req);
  if (authErr) return authErr;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const result = {
    synced: 0,
    closedPropagated: 0,
    chainedRetried: 0,
    dossiersBuilt: 0,
    orphanClaimsReleased: 0,
    errors: 0,
  };

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
  // IDs cujo envelope o step 1 acabou de fechar → o syncEnvelopeState JÁ propagou
  // (onProposalEnvelopeClosed, que encadeia o 2º envelope via waitUntil). NÃO
  // chamar de novo aqui: a dupla-chamada agendava DOIS sendVendedorEnvelope e, com
  // Redis fora (lock fail-open), ambos passavam o guard TOCTOU → cobrança dobrada.
  // Só contabiliza e marca pro step 2 não redisparar.
  const chainedInStep1 = new Set<string>();
  for (const env of envelopes) {
    try {
      const r = await syncEnvelopeState(env, { actorVia: "cron-reconcile" });
      result.synced++;
      if (r.remoteStatus === "closed" || r.remoteStatus === "finished") {
        if (env.proposalId) chainedInStep1.add(env.proposalId);
        result.closedPropagated++;
      }
    } catch {
      result.errors++;
    }
  }

  // 2. aguardando_vendedor sem reduzida viva → redispara. `none` cobre só
  // running/closed (NÃO draft): um draft VELHO significa que o envio crashou no
  // meio e PRECISA ser retentado — excluí-lo abandonava a proposta pra sempre.
  // Redisparar é seguro: sendVendedorEnvelope é serializado pelo lock e a guarda
  // interna trata draft recente (em voo) como no-op. Só excluímos as propostas que
  // o step 1 acabou de encadear NESTE run (o waitUntil delas já está a caminho).
  const stuck = await prisma.proposal.findMany({
    where: {
      status: "aguardando_vendedor",
      envelopes: { none: { via: "reduzida", status: { in: ["running", "closed"] } } },
      ...(chainedInStep1.size > 0 ? { id: { notIn: [...chainedInStep1] } } : {}),
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

  // 4. Claim órfão de envio. `sentAt: null` discrimina o claim morto no meio do
  // caminho: os DOIS caminhos felizes (envelope e aceite) gravam sentAt como
  // último passo. O guard de envelope vivo é cinto-e-suspensório pro caso raro
  // de envelope running com o update de sentAt perdido — aí o sync (step 1)
  // é quem reconcilia, não a liberação. 30min >> maxDuration de 60s do /send.
  const orphanCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const orphans = await prisma.proposal.findMany({
    where: {
      status: "enviada",
      sentAt: null,
      updatedAt: { lt: orphanCutoff },
      envelopes: { none: { status: { in: ["running", "closed"] } } },
    },
    select: { id: true },
    take: 50,
  });
  for (const p of orphans) {
    try {
      await recoverOrphanClaim(p.id);
      result.orphanClaimsReleased++;
    } catch {
      result.errors++;
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
