import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { advanceProposalStatus, isTerminal } from "@/lib/proposals/status";
import { runEnvelopeCancel } from "@/lib/clicksign/cancel-action";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ reason: z.string().min(3).max(500) });

/**
 * POST /api/proposals/[id]/cancel — encerra a proposta (status `cancelada`) sem
 * excluir. Cancela best-effort os envelopes ClickSign em curso. `cancelada` é um
 * alvo válido de quase todo estado ativo (ALLOWED_FROM.cancelada).
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

  if (isTerminal(proposal.status)) {
    return NextResponse.json({ error: "Proposta já encerrada." }, { status: 409 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
  }
  const { reason } = parsed.data;

  const adv = await advanceProposalStatus(proposal.id, "cancelada", { canceledAt: new Date() });
  if (!adv.moved && adv.reason === "illegal") {
    return NextResponse.json(
      { error: "Não é possível cancelar neste estado." },
      { status: 409 }
    );
  }

  // Best-effort: cancela na ClickSign os envelopes em curso (nunca aborta o cancel).
  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: proposal.id, status: "running", clicksignId: { not: null } },
    select: { id: true },
  });
  for (const env of envelopes) {
    await runEnvelopeCancel({
      envelopeId: env.id,
      reason,
      actorUserId: auth.actor.effectiveUserId,
    }).catch(() => {});
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
      metadata: { reason, from: proposal.status },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, status: "cancelada" });
}
