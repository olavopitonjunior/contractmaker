import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "./status";
import { sendVendedorEnvelope } from "./send-execute";

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

  if (env.via === "reduzida") {
    // Via do proprietário fechou → tudo assinado.
    await advanceProposalStatus(env.proposalId, "completa", { completedAt: new Date() });
    return;
  }

  // via === "completa": os proponentes assinaram.
  await advanceProposalStatus(env.proposalId, "assinada_proponente");

  // Há proprietário/vendedor pra assinar? (decisão do usuário: SEMPRE 2º envelope
  // encadeado pro vendedor — reduzida se esconder comissão, completa se não.)
  const vendedores = await prisma.proposalSigner.count({
    where: { proposalId: env.proposalId, included: true, role: "vendedor" },
  });
  if (vendedores === 0) {
    // Só proponentes → proposta completa.
    await advanceProposalStatus(env.proposalId, "completa", { completedAt: new Date() });
    return;
  }

  // Encadeia: aguarda o vendedor e DISPARA o 2º envelope (idempotente pelo
  // @@unique([proposalId, via]) + guard de existência dentro de sendVendedorEnvelope).
  await advanceProposalStatus(env.proposalId, "aguardando_vendedor");
  waitUntil(
    sendVendedorEnvelope(env.proposalId).catch((err) => {
      console.error("[proposals] sendVendedorEnvelope falhou:", err);
    })
  );
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
