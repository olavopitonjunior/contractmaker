import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "./status";
import { buildAcceptanceProof, buildAcceptanceMessage } from "./acceptance-proof";

/**
 * Ponte webhook ClickSign → Proposal para o Aceite via WhatsApp
 * (`acceptance_term_*`). Diferente do envelope, o Aceite não tem `document.key`;
 * é resolvido pelo `acceptance_term` id gravado em `Proposal.acceptanceClicksignId`.
 *
 * O ciclo de vida da proposta é dirigido pelo termo do PROPONENTE (o vinculante,
 * cujo id fica em `acceptanceClicksignId`). Aceites suplementares (proprietário
 * como terceiro) são registrados mas não redefinem o desfecho — o schema atual
 * não rastreia aceite por-signatário.
 */

interface AcceptanceEventInput {
  acceptanceId: string;
  phase: string; // sent | completed | refused | expired | canceled | error | ...
  payload: unknown;
  orgId?: string;
}

export interface AcceptanceProcessResult {
  ok: true;
  handled: boolean;
  proposalId?: string;
  phase: string;
  unknownAcceptance?: boolean;
}

function factsFromPayload(payload: unknown): {
  signerName?: string;
  signerPhone?: string;
  sentAt?: string;
  completedAt?: string;
} {
  const p = payload as {
    event?: {
      data?: {
        acceptance_term?: {
          signer_name?: string;
          signer_phone?: string;
          sent_at?: string;
          completed_at?: string;
        };
        signer_name?: string;
        signer_phone?: string;
      };
      occurred_at?: string;
    };
  };
  const a = p.event?.data?.acceptance_term;
  return {
    signerName: a?.signer_name ?? p.event?.data?.signer_name,
    signerPhone: a?.signer_phone ?? p.event?.data?.signer_phone,
    sentAt: a?.sent_at,
    completedAt: a?.completed_at ?? p.event?.occurred_at,
  };
}

export async function processProposalAcceptanceEvent(
  input: AcceptanceEventInput
): Promise<AcceptanceProcessResult> {
  const orgScope = input.orgId ? { orgId: input.orgId } : {};
  const proposal = await prisma.proposal.findFirst({
    where: { acceptanceClicksignId: input.acceptanceId, ...orgScope },
    select: {
      id: true,
      title: true,
      token: true,
      instrument: true,
    },
  });
  if (!proposal) {
    return { ok: true, handled: false, phase: input.phase, unknownAcceptance: true };
  }

  // Registra SEMPRE o evento cru na timeline da proposta (durabilidade §9.6).
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: `acceptance_term_${input.phase}`,
        source: "webhook",
        payload: input.payload as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  const facts = factsFromPayload(input.payload);

  switch (input.phase) {
    case "sent":
      // No Aceite a ClickSign confirma a ENTREGA — "Entregue" é real neste modo.
      await advanceProposalStatus(proposal.id, "entregue", { deliveredAt: new Date() });
      break;

    case "completed": {
      // O proponente aceitou: proposta completa. Reusa as transições existentes
      // (enviada/entregue/visualizada → assinada_proponente → completa) em vez
      // de alargar ALLOWED_FROM.
      await advanceProposalStatus(proposal.id, "assinada_proponente");
      await advanceProposalStatus(proposal.id, "completa", { completedAt: new Date() });

      // Comprovante durável — o requisito central do modo Aceite. Fire-and-forget
      // (idempotente por dossierUrl). O texto aceito é reconstruído idêntico ao
      // enviado, pelo helper compartilhado.
      const link = `${process.env.NEXTAUTH_URL ?? "https://staging.imobpro.ia.br"}/p/${proposal.token}`;
      const acceptedText = buildAcceptanceMessage({
        numero: proposal.id.slice(-8),
        title: proposal.title,
        link,
      });
      waitUntil(
        buildAcceptanceProof(proposal.id, {
          signerName: facts.signerName ?? "—",
          signerPhone: facts.signerPhone ?? "—",
          acceptanceId: input.acceptanceId,
          sentAt: facts.sentAt ?? null,
          completedAt: facts.completedAt ?? new Date().toISOString(),
          acceptedText,
        }).catch((err) => {
          console.error("[proposals] buildAcceptanceProof falhou:", err);
        })
      );
      break;
    }

    case "refused":
      await advanceProposalStatus(proposal.id, "recusada_proponente", {
        refusedAt: new Date(),
      });
      break;

    case "expired":
      await advanceProposalStatus(proposal.id, "expirada", { expiredAt: new Date() });
      break;

    case "canceled":
      await advanceProposalStatus(proposal.id, "cancelada", { canceledAt: new Date() });
      break;

    default:
      // created/error/desconhecido: só o log acima (sem mutação de status).
      return { ok: true, handled: false, proposalId: proposal.id, phase: input.phase };
  }

  return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
}
