import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { createReducedEnvelope } from "@/lib/proposals/send-execute";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/[id]/send-vendedor — dispara a 2ª via (envelope reduzido)
 * para o vendedor/proprietário assinar, nas propostas de duas vias (comissão
 * oculta) que já estão em `aguardando_vendedor`. Cria envelope ClickSign real.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  if (proposal.status !== "aguardando_vendedor") {
    return NextResponse.json(
      { error: "Proposta não está aguardando o vendedor." },
      { status: 409 }
    );
  }

  const result = await createReducedEnvelope(proposal.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_SEND_COUNTERPARTY",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { envelopeId: result.envelopeId },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, envelopeId: result.envelopeId });
}
