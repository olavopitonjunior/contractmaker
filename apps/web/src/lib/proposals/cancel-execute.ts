import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus } from "@/lib/proposals/status";
import { CANCELLABLE_STATUSES } from "@/lib/proposals/status-sets";
import { runEnvelopeCancel } from "@/lib/clicksign/cancel-action";
import { audit } from "@/lib/security/audit";

export interface ProposalCancelArgs {
  proposalId: string;
  orgId: string;
  reason: string;
  actorUserId: string;
  /** Contexto de request pro audit (ip/UA). Executor de intent não tem req → omite. */
  ipAddress?: string | null;
  userAgent?: string | null;
  /** true quando executado via ActionIntent aprovada (origem Bearer/Newton). */
  viaNewton?: boolean;
}

export interface ProposalCancelResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Cancela a proposta (status `cancelada`) cancelando PRIMEIRO os envelopes
 * ClickSign em curso — se algum não cancelar, retorna 409 sem tocar o status
 * (um envelope que a ClickSign recusar cancelar ainda pode ser assinado, e
 * marcar `cancelada` antes deixaria um contrato assinado preso em terminal).
 *
 * Compartilhada entre a rota POST /api/proposals/[id]/cancel (caminho session)
 * e o executor de intent PROPOSAL_CANCEL (caminho bearer pós-aprovação HITL).
 */
export async function runProposalCancel(
  args: ProposalCancelArgs
): Promise<ProposalCancelResult> {
  const { proposalId, orgId, reason, actorUserId, ipAddress, userAgent, viaNewton } =
    args;

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.orgId !== orgId) {
    return { status: 404, body: { error: "Proposta não encontrada." } };
  }
  if (!CANCELLABLE_STATUSES.has(proposal.status)) {
    return {
      status: 409,
      body: { error: "Não é possível cancelar neste estado." },
    };
  }

  // Cancela os envelopes em curso ANTES de mudar o status. Se algum não cancelar
  // na ClickSign, aborta (409) sem tocar o status — o envelope ainda é assinável.
  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: proposal.id, status: "running", clicksignId: { not: null } },
    select: { id: true },
  });
  for (const env of envelopes) {
    const res = await runEnvelopeCancel({
      envelopeId: env.id,
      reason,
      actorUserId,
    }).catch((err) => ({
      status: 502,
      body: { error: err instanceof Error ? err.message : String(err) },
    }));
    if (res.status >= 400) {
      const msg =
        (res.body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
      return {
        status: 409,
        body: { error: `Não foi possível cancelar a assinatura na ClickSign: ${msg}` },
      };
    }
  }

  // Todos os envelopes cancelados (ou nenhum ativo) → marca a proposta.
  const adv = await advanceProposalStatus(proposal.id, "cancelada", {
    canceledAt: new Date(),
  });
  if (!adv.moved && adv.reason === "illegal") {
    return {
      status: 409,
      body: { error: "Não é possível cancelar neste estado." },
    };
  }

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "canceled",
        source: "system",
        payload: { reason } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  await audit(
    {
      orgId,
      userId: actorUserId,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
    {
      action: "PROPOSAL_CANCEL",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: {
        reason,
        from: proposal.status,
        envelopes: envelopes.length,
        ...(viaNewton ? { via: "newton" } : {}),
      },
    }
  ).catch(() => {});

  return { status: 200, body: { ok: true, status: "cancelada" } };
}
