import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { advanceProposalStatus, isTerminal } from "@/lib/proposals/status";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/[id]/cancel — cancela a proposta INTEIRA: cancela cada
 * envelope vivo na ClickSign (resiliente via cancelEnvelopeFlow) e marca a
 * proposta `cancelada`. Bloqueia se já completa/convertida (terminal) ou se um
 * envelope já fechou (assinado) — nesse caso cancelEnvelopeFlow lança 409.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const proposal = await prisma.proposal.findUnique({ where: { id: params.id } });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (
    !eff ||
    !canAccessProposal({ effective: eff, ownerUserId: proposal.userId }) ||
    !can(eff, PERMISSION.PROPOSAL_SEND)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isTerminal(proposal.status)) {
    return NextResponse.json(
      { error: "Esta proposta já está encerrada e não pode ser cancelada." },
      { status: 409 }
    );
  }

  // Cancela cada envelope vivo. Um envelope já `closed` (assinado) faz
  // cancelEnvelopeFlow lançar — aí a proposta não pode ser cancelada.
  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: params.id, status: { in: ["draft", "running"] } },
    select: { id: true },
  });
  try {
    for (const e of envelopes) {
      await cancelEnvelopeFlow(e.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Não foi possível cancelar: ${msg}` },
      { status: 409 }
    );
  }

  const moved = await advanceProposalStatus(params.id, "cancelada", { canceledAt: new Date() });
  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    { action: "PROPOSAL_CANCEL", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { scope: "proposal", envelopes: envelopes.length } }
  ).catch(() => {});

  return NextResponse.json({ ok: true, status: "cancelada", moved: moved.moved });
}
