import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "./status";

/**
 * Ponte webhook ClickSign → Proposal, para envelopes com `source="proposal"`.
 * No-op para envelopes de contrato/attachment. Chamado do webhook-process.ts,
 * espelhando `autoPromoteDealOnContractSigned`.
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

  const proposal = await prisma.proposal.findUnique({
    where: { id: env.proposalId },
    select: { hiddenPaths: true },
  });
  if (!proposal) return;
  const hasHidden = proposal.hiddenPaths.length > 0;

  if (env.via === "reduzida") {
    // Via do proprietário fechou → tudo assinado.
    await advanceProposalStatus(env.proposalId, "completa", { completedAt: new Date() });
    return;
  }

  // via === "completa" (ou null em via única).
  await advanceProposalStatus(env.proposalId, "assinada_proponente");

  if (!hasHidden) {
    // Via única: proponente + proprietário no mesmo envelope → completa.
    await advanceProposalStatus(env.proposalId, "completa", { completedAt: new Date() });
    return;
  }

  // Duas vias: falta disparar o envelope 2 (reduzida). A criação depende do
  // executor de envio de proposta (lib/proposals/send — vem com POST /send).
  // Aqui registramos a pendência; o /send/reconcile cria o envelope 2 e o
  // @@unique([proposalId, via]) garante idempotência.
  await advanceProposalStatus(env.proposalId, "aguardando_vendedor");
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: env.proposalId,
        eventName: "chained_envelope2_pending",
        source: "webhook",
      },
    })
    .catch(() => {});
}

/** Recusa de um envelope de proposta. */
export async function onProposalEnvelopeRefused(
  envelopeId: string
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;

  // Recusa na via reduzida = proprietário recusou (o desfecho quente: há um
  // comprador já comprometido). Na via completa/única = proponente recusou.
  const to = env.via === "reduzida" ? "recusada_vendedor" : "recusada_proponente";
  await advanceProposalStatus(env.proposalId, to, { refusedAt: new Date() });
}
