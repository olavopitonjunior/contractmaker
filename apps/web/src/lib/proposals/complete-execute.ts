import { waitUntil } from "@vercel/functions";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { advanceProposalStatus } from "./status";
import { buildDossier } from "./dossier";
import { notifyProposalMilestone } from "./notify-proposal";

/**
 * "Concluir sem enviar ao proprietário" — o 2º braço da parada de decisão
 * (o 1º é enviar a 2ª via). Só vale em `assinada_proponente`: o proponente
 * assinou e o corretor decidiu que a via do proprietário não é necessária.
 *
 * `waitUntil(buildDossier)` é OBRIGATÓRIO: o gate do dossiê é `completa`, e o
 * convert bloqueia com `dossier_pending` até o dossiê existir — sem o disparo
 * aqui, a conversão ficaria travada até o cron reconcile diário (07:00).
 *
 * Compartilhado entre a rota POST /api/proposals/[id]/complete (session) e o
 * executor do intent PROPOSAL_COMPLETE (Bearer pós-aprovação) — padrão
 * PROPOSAL_CANCEL.
 */
export async function runProposalComplete(input: {
  proposalId: string;
  orgId: string;
  actorUserId: string;
  reason?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, orgId: true, userId: true, status: true },
  });
  if (!proposal || proposal.orgId !== input.orgId) {
    return { status: 404, body: { error: "Proposta não encontrada." } };
  }
  if (proposal.status !== "assinada_proponente") {
    return {
      status: 409,
      body: {
        error:
          "Concluir sem enviar só vale quando o proponente assinou e a proposta está aguardando a sua decisão.",
      },
    };
  }

  const adv = await advanceProposalStatus(proposal.id, "completa", {
    completedAt: new Date(),
  });
  if (!adv.moved) {
    // Corrida: outro caminho (envio da 2ª via, cancelamento) mexeu antes.
    return {
      status: 409,
      body: { error: "A proposta mudou de estado — recarregue e tente de novo." },
    };
  }

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "completed_manually",
        source: "user",
        payload: {
          reason: input.reason?.trim() || null,
          actorUserId: input.actorUserId,
        } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  await audit(
    { orgId: input.orgId, userId: input.actorUserId },
    {
      action: "PROPOSAL_COMPLETE",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { reason: input.reason?.trim() || null, manual: true },
    }
  ).catch(() => {});

  waitUntil(
    notifyProposalMilestone({
      proposalId: proposal.id,
      orgId: proposal.orgId,
      userId: proposal.userId,
      kind: "completed",
    })
  );
  waitUntil(
    buildDossier(proposal.id).catch((err) => {
      console.error("[proposals] buildDossier pós-complete falhou:", err);
    })
  );

  return { status: 200, body: { ok: true, status: "completa" } };
}
