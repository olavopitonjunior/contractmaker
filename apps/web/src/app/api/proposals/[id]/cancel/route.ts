import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { runProposalCancel } from "@/lib/proposals/cancel-execute";
import { CANCELLABLE_STATUSES } from "@/lib/proposals/status-sets";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ reason: z.string().min(3).max(500) });

/**
 * POST /api/proposals/[id]/cancel — encerra a proposta (status `cancelada`) sem
 * excluir. Lógica em `runProposalCancel` (cancela envelopes ClickSign primeiro;
 * 409 se algum não cancelar). Session executa direto; Bearer cria ActionIntent
 * `PROPOSAL_CANCEL` (202) — cancelar destrói envelopes em curso e re-enviar
 * gasta orçamento ClickSign de novo, então exige aprovação humana.
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

  const result = await requireApproval({
    ctx: auth,
    action: "PROPOSAL_CANCEL",
    payload: { proposalId: proposal.id, reason },
    preview: {
      summary: `Cancelar a proposta "${proposal.title ?? proposal.id}"`,
      details: {
        proposalId: proposal.id,
        status: proposal.status,
        reason,
      },
    },
    req,
    idempotencyKey: req.headers.get("x-idempotency-key"),
    // Cancelar é irreversível, mas quem pede é o dono da proposta e o pedido é
    // explícito ("cancela essa proposta"). Segurar atrás de uma aprovação que só
    // existe na tela do app deixaria o corretor sem saída pelo WhatsApp — o
    // mesmo beco do /send. A intent fica gravada como `executed`, com quem pediu.
    autoApprove: true,
    run: async () => {
      const res = await runProposalCancel({
        proposalId: proposal.id,
        orgId: auth.org.id,
        reason,
        actorUserId: auth.actor.effectiveUserId,
        ipAddress:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip"),
        userAgent: req.headers.get("user-agent"),
      });
      return { status: res.status, body: res.body };
    },
  });
  return approvalResponse(result);
}
