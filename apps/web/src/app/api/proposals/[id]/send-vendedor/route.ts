import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import {
  sendVendedorVia,
  vendedorResultToResponse,
} from "@/lib/proposals/send-execute";
import { SEND_VENDEDOR_STATUSES } from "@/lib/proposals/status-sets";
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

  // Parada de decisão (assinada_proponente) é o caminho feliz; aguardando_
  // vendedor cobre o retry manual quando a 2ª via falhou em criar envelope.
  if (!SEND_VENDEDOR_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "A proposta não está no ponto de enviar a via do proprietário." },
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
    // Mesma razão do /send: pedir o envio já é a autorização, e travar a 2ª via
    // atrás de aprovação deixaria a proposta parada em `aguardando_vendedor`
    // esperando um passo que quem pediu não consegue dar pelo WhatsApp.
    autoApprove: true,
    run: async () => {
      // Resultado ESTRUTURADO: distingue o motivo real em vez de inferir por
      // presença de envelope (que escondia budget/lock atrás de um 422).
      const sendResult = await sendVendedorVia(proposal.id, "manual").catch(
        (err): Awaited<ReturnType<typeof sendVendedorVia>> => ({
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
