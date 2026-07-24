import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import {
  sendVendedorEnvelope,
  vendedorResultToResponse,
} from "@/lib/proposals/send-execute";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/[id]/send-vendedor — dispara a 2ª via (envelope do
 * vendedor/proprietário) manualmente, nas propostas em `aguardando_vendedor`.
 * Reusa `sendVendedorEnvelope` (a mesma que o webhook encadeia automaticamente):
 * idempotente (`@@unique[proposalId, via]`), no-op sem vendedor.
 *
 * Session executa direto; Bearer cria ActionIntent (202) — gasta orçamento
 * ClickSign. Reusa a action `PROPOSAL_SEND` com payload `{ via: "vendedor" }`
 * (o executor roteia pro sendVendedorEnvelope pelo discriminador).
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

  const result = await requireApproval({
    ctx: auth,
    action: "PROPOSAL_SEND",
    payload: { proposalId: proposal.id, via: "vendedor" },
    preview: {
      summary: `Enviar a 2ª via (vendedor/proprietário) da proposta "${proposal.title}"`,
      details: { proposalId: proposal.id, status: proposal.status },
    },
    req,
    idempotencyKey: req.headers.get("x-idempotency-key"),
    run: async () => {
      // Resultado ESTRUTURADO: distingue o motivo real em vez de inferir por
      // presença de envelope (que escondia budget/lock atrás de um 422).
      const sendResult = await sendVendedorEnvelope(proposal.id).catch(
        (err): Awaited<ReturnType<typeof sendVendedorEnvelope>> => ({
          ok: false,
          reason: "error",
          detail: err instanceof Error ? err.message : String(err),
        })
      );
      const res = vendedorResultToResponse(sendResult);
      if (res.status < 400) {
        await audit(
          extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
          {
            action: "PROPOSAL_SEND_COUNTERPARTY",
            result: "SUCCESS",
            resource: proposal.id,
            resourceType: "Proposal",
          }
        ).catch(() => {});
      }
      return res;
    },
  });
  return approvalResponse(result);
}
