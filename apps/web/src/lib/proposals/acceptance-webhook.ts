import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "./status";
import { buildAcceptanceProof, buildAcceptanceMessage } from "./acceptance-proof";
import { notifyProposalMilestone } from "./notify-proposal";

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

  // Resolve por SIGNATÁRIO primeiro (cada ProposalSigner tem seu acceptance_term)
  // e cai pra Proposal.acceptanceClicksignId (compat). Saber QUEM aceitou é o que
  // permite (a) marcar o desfecho do signatário certo, (b) só completar quando o
  // PROPONENTE aceitar, (c) não descartar a recusa de um proprietário.
  const signer = await prisma.proposalSigner.findFirst({
    where: {
      acceptanceClicksignId: input.acceptanceId,
      ...(input.orgId ? { proposal: { orgId: input.orgId } } : {}),
    },
    select: { id: true, role: true, proposalId: true },
  });
  const proposal = signer
    ? await prisma.proposal.findUnique({
        where: { id: signer.proposalId },
        select: { id: true, orgId: true, title: true, token: true, instrument: true, validUntil: true },
      })
    : await prisma.proposal.findFirst({
        where: { acceptanceClicksignId: input.acceptanceId, ...orgScope },
        select: { id: true, orgId: true, title: true, token: true, instrument: true, validUntil: true },
      });
  if (!proposal) {
    return { ok: true, handled: false, phase: input.phase, unknownAcceptance: true };
  }

  // O signatário é o proponente quando resolvemos por linha e role="proponente",
  // OU quando caímos no fallback (Proposal.acceptanceClicksignId aponta pro
  // proponente por construção no envio).
  const isProponente = signer ? signer.role === "proponente" : true;

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

  // Marca o desfecho NA LINHA do signatário (quando resolvido por linha).
  if (signer) {
    const perSigner: Record<string, { acceptanceStatus: string; acceptedAt?: Date; refusedAt?: Date }> = {
      completed: { acceptanceStatus: "completed", acceptedAt: new Date() },
      refused: { acceptanceStatus: "refused", refusedAt: new Date() },
      expired: { acceptanceStatus: "expired" },
      canceled: { acceptanceStatus: "canceled" },
    };
    const upd = perSigner[input.phase];
    if (upd) {
      await prisma.proposalSigner
        .update({ where: { id: signer.id }, data: upd })
        .catch(() => {});
    }
  }

  switch (input.phase) {
    case "sent":
      // No Aceite a ClickSign confirma a ENTREGA — "Entregue" é real neste modo.
      await advanceProposalStatus(proposal.id, "entregue", { deliveredAt: new Date() });
      break;

    case "completed": {
      // Só o aceite do PROPONENTE completa a proposta. O aceite de um proprietário
      // (terceiro) é registrado na linha dele, mas não redefine o desfecho —
      // antes, com 1 aceite de qualquer um a proposta virava "completa".
      if (!isProponente) {
        // Sino por-signatário: um proprietário aceitou o termo dele. Suffix
        // obrigatório — sem ele o aceite do 2º proprietário seria engolido
        // pelo unique (type, batchId).
        await notifyProposalMilestone({
          proposalId: proposal.id,
          orgId: proposal.orgId,
          kind: "accepted_party",
          dedupeSuffix: signer!.id,
        });
        return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
      }

      // Caducidade (CC art. 431): aceite após validUntil não vincula. Compara com
      // a HORA REAL do aceite (completed_at do payload), não com o relógio de
      // processamento — senão um aceite tempestivo (23:59) cujo webhook chega/
      // reprocessa depois do vencimento (00:05) seria descartado indevidamente.
      const acceptedAtReal = facts.completedAt ? new Date(facts.completedAt) : new Date();
      const acceptedAtValid = !Number.isNaN(acceptedAtReal.getTime());
      if (proposal.validUntil && acceptedAtValid && acceptedAtReal > proposal.validUntil) {
        await advanceProposalStatus(proposal.id, "expirada", { expiredAt: new Date() });
        await notifyProposalMilestone({
          proposalId: proposal.id,
          orgId: proposal.orgId,
          kind: "expired",
        });
        return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
      }

      // O proponente aceitou dentro do prazo: proposta completa. Reusa as
      // transições existentes em vez de alargar ALLOWED_FROM.
      await advanceProposalStatus(proposal.id, "assinada_proponente");
      await advanceProposalStatus(proposal.id, "completa", { completedAt: new Date() });
      await notifyProposalMilestone({
        proposalId: proposal.id,
        orgId: proposal.orgId,
        kind: "completed",
      });

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
      // Quem recusou importa. O proponente recusar é terminal frio
      // (recusada_proponente). O VENDEDOR/proprietário recusar deixa um
      // comprador comprometido na mão → estado quente (recusada_vendedor).
      // Antes, sem o guard, a recusa de qualquer terceiro virava
      // "recusada_proponente" — atribuição errada do desfecho.
      if (isProponente) {
        await advanceProposalStatus(proposal.id, "recusada_proponente", {
          refusedAt: new Date(),
        });
      } else {
        await advanceProposalStatus(proposal.id, "recusada_vendedor", {
          refusedAt: new Date(),
        });
      }
      // Suffix por signatário: recusas de partes diferentes são sinos distintos.
      await notifyProposalMilestone({
        proposalId: proposal.id,
        orgId: proposal.orgId,
        kind: "refused",
        refusedBy: isProponente ? "proponente" : "vendedor",
        dedupeSuffix: signer?.id,
      });
      break;

    case "expired":
      // Só o vencimento do termo do PROPONENTE (o vinculante) expira a proposta.
      // O termo de um terceiro expirar não mata o negócio — o proponente ainda
      // pode aceitar. Sem o guard, a expiração de qualquer termo terminava tudo.
      if (isProponente) {
        await advanceProposalStatus(proposal.id, "expirada", { expiredAt: new Date() });
        await notifyProposalMilestone({
          proposalId: proposal.id,
          orgId: proposal.orgId,
          kind: "expired",
        });
      }
      break;

    case "canceled":
      // Idem: só o cancelamento do termo do proponente cancela a proposta.
      if (isProponente) {
        await advanceProposalStatus(proposal.id, "cancelada", { canceledAt: new Date() });
      }
      break;

    default:
      // created/error/desconhecido: só o log acima (sem mutação de status).
      return { ok: true, handled: false, proposalId: proposal.id, phase: input.phase };
  }

  return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
}
