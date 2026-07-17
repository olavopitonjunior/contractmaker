import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "./status";
import { notifyProposalMilestone } from "./notify-proposal";

/**
 * Ponte webhook ClickSign → Proposal, para envelopes com `source="proposal"`.
 * No-op para envelopes de contrato/attachment. Chamado do webhook-process.ts,
 * espelhando `autoPromoteDealOnContractSigned`.
 *
 * Sinos (notify-proposal) SÓ quando `advanceProposalStatus` reporta
 * `moved:true` — evento tardio/replay numa proposta cancelada/convertida não
 * pode tocar sino falso nem consumir o batchId de um marco legítimo futuro.
 * Emissão via waitUntil: não atrasa a resposta do webhook.
 */

/** Fechamento (close/auto_close) de um envelope de proposta. */
export async function onProposalEnvelopeClosed(
  envelopeId: string
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  const proposalId = env.proposalId;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true, userId: true, hiddenPaths: true },
  });
  if (!proposal) return;
  const hasHidden = proposal.hiddenPaths.length > 0;

  const notifyCompleted = () =>
    waitUntil(
      notifyProposalMilestone({
        proposalId,
        orgId: proposal.orgId,
        userId: proposal.userId,
        kind: "completed",
      })
    );

  if (env.via === "reduzida") {
    // Via do proprietário fechou → tudo assinado.
    const adv = await advanceProposalStatus(proposalId, "completa", {
      completedAt: new Date(),
    });
    if (adv.moved) notifyCompleted();
    return;
  }

  // via === "completa" (ou null em via única).
  await advanceProposalStatus(proposalId, "assinada_proponente");

  if (!hasHidden) {
    // Via única: proponente + proprietário no mesmo envelope → completa.
    const adv = await advanceProposalStatus(proposalId, "completa", {
      completedAt: new Date(),
    });
    if (adv.moved) notifyCompleted();
    return;
  }

  // Duas vias: falta disparar o envelope 2 (reduzida). A criação depende do
  // executor de envio de proposta (lib/proposals/send — vem com POST /send).
  // Aqui registramos a pendência; o /send/reconcile cria o envelope 2 e o
  // @@unique([proposalId, via]) garante idempotência.
  await advanceProposalStatus(proposalId, "aguardando_vendedor");
  await prisma.proposalEvent
    .create({
      data: {
        proposalId,
        eventName: "chained_envelope2_pending",
        source: "webhook",
      },
    })
    .catch(() => {});
}

/**
 * Recusa de um envelope de proposta.
 *
 * `refusedSourceKind` é o `EnvelopeSigner.sourceKind` do signatário que
 * RECUSOU (resolvido pelo webhook-process): na via ÚNICA proponente e
 * proprietário assinam o mesmo envelope, então a via sozinha não diz quem
 * recusou — sem o hint, a recusa do proprietário (o desfecho QUENTE: há um
 * comprador comprometido) era atribuída ao proponente.
 */
export async function onProposalEnvelopeRefused(
  envelopeId: string,
  opts: { refusedSourceKind?: string | null } = {}
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true, orgId: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  const proposalId = env.proposalId;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { userId: true },
  });
  if (!proposal) return;

  // Quem recusou: via reduzida = sempre o proprietário; nas demais, o
  // sourceKind do signatário resolvido decide ("vendedor" = proprietário).
  // Sem hint (payload sem key/e-mail resolvível), assume proponente.
  const refusedBy =
    env.via === "reduzida" || opts.refusedSourceKind === "vendedor"
      ? ("vendedor" as const)
      : ("proponente" as const);
  const to = refusedBy === "vendedor" ? "recusada_vendedor" : "recusada_proponente";
  const adv = await advanceProposalStatus(proposalId, to, {
    refusedAt: new Date(),
  });
  if (adv.moved) {
    waitUntil(
      notifyProposalMilestone({
        proposalId,
        orgId: env.orgId,
        userId: proposal.userId,
        kind: "refused",
        refusedBy,
        // Suffix por via: recusas nas duas vias são sinos distintos.
        dedupeSuffix: env.via ?? undefined,
      })
    );
  }
}
