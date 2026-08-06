import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { runProposalComplete } from "@/lib/proposals/complete-execute";
import { AWAITING_DECISION_STATUSES } from "@/lib/proposals/status-sets";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ reason: z.string().max(500).optional() });

/**
 * POST /api/proposals/[id]/complete — "Concluir sem enviar ao proprietário":
 * fecha a proposta em `completa` a partir da parada de decisão
 * (`assinada_proponente`). Mesma permissão dos dois botões da parada
 * (PROPOSAL_SEND — é a decisão do handoff). Lógica em `runProposalComplete`
 * (dispara o dossiê via waitUntil — sem isso o convert trava em
 * dossier_pending até o cron diário).
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

  if (!AWAITING_DECISION_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      {
        error:
          "Concluir sem enviar só vale quando o proponente assinou e a proposta aguarda a sua decisão.",
      },
      { status: 409 }
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  }
  const reason = parsed.data.reason?.trim() || null;

  const result = await requireApproval({
    ctx: auth,
    action: "PROPOSAL_COMPLETE",
    payload: { proposalId: proposal.id, reason },
    preview: {
      summary: `Concluir a proposta "${proposal.title ?? proposal.id}" sem enviar ao proprietário`,
      details: { proposalId: proposal.id, status: proposal.status, reason },
    },
    req,
    idempotencyKey: req.headers.get("x-idempotency-key"),
    // Mesma razão do /cancel: a decisão explícita do dono é a autorização; sem
    // autoApprove a jornada via WhatsApp ficaria presa numa aprovação da tela.
    autoApprove: true,
    run: async () =>
      runProposalComplete({
        proposalId: proposal.id,
        orgId: auth.org.id,
        actorUserId: auth.actor.effectiveUserId,
        reason,
      }),
  });
  return approvalResponse(result);
}
