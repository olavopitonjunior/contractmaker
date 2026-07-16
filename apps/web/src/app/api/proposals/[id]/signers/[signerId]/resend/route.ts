import { NextRequest, NextResponse } from "next/server";
import { resendSignerAction } from "@/lib/clicksign/signer-actions";
import { loadScopedProposalSigner } from "@/lib/proposals/scoped-signer";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/proposals/[id]/signers/[signerId]/resend — reenvia a notificação de
 * assinatura (cooldown 1h / máx 5), útil quando o contato foi corrigido. Reusa o
 * resendSignerAction dos contratos; escopo anti-IDOR pela proposta.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; signerId: string } }
) {
  const scoped = await loadScopedProposalSigner(req, params.id, params.signerId);
  if ("fail" in scoped) return scoped.fail;

  const result = await resendSignerAction(scoped.signer);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await audit(
    extractAuditContextFromRequest(req, scoped.auth.org.id, scoped.auth.actor.effectiveUserId),
    { action: "PROPOSAL_UPDATE", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { signerId: params.signerId, action: "resend" } }
  ).catch(() => {});
  return NextResponse.json({ ok: true, signer: result.data });
}
