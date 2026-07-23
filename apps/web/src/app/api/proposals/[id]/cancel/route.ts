import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { advanceProposalStatus } from "@/lib/proposals/status";
import { CANCELLABLE_STATUSES } from "@/lib/proposals/status-sets";
import { runEnvelopeCancel } from "@/lib/clicksign/cancel-action";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ reason: z.string().min(3).max(500) });

/**
 * POST /api/proposals/[id]/cancel — encerra a proposta (status `cancelada`) sem
 * excluir. Cancela os envelopes ClickSign em curso PRIMEIRO e só marca
 * `cancelada` se todos forem cancelados — senão retorna 409 e mantém a proposta
 * ativa (um envelope que a ClickSign recusar cancelar ainda pode ser assinado, e
 * marcar `cancelada` antes deixaria um contrato assinado preso em terminal).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_CANCEL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  if (!CANCELLABLE_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Não é possível cancelar neste estado." },
      { status: 409 }
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
  }
  const { reason } = parsed.data;

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
      actorUserId: auth.actor.effectiveUserId,
    }).catch((err) => ({
      status: 502,
      body: { error: err instanceof Error ? err.message : String(err) },
    }));
    if (res.status >= 400) {
      const msg =
        (res.body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
      return NextResponse.json(
        { error: `Não foi possível cancelar a assinatura na ClickSign: ${msg}` },
        { status: 409 }
      );
    }
  }

  // Todos os envelopes cancelados (ou nenhum ativo) → marca a proposta.
  const adv = await advanceProposalStatus(proposal.id, "cancelada", { canceledAt: new Date() });
  if (!adv.moved && adv.reason === "illegal") {
    return NextResponse.json(
      { error: "Não é possível cancelar neste estado." },
      { status: 409 }
    );
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
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_CANCEL",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { reason, from: proposal.status, envelopes: envelopes.length },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, status: "cancelada" });
}
