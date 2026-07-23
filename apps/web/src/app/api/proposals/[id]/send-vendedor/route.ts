import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { sendVendedorEnvelope } from "@/lib/proposals/send-execute";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/[id]/send-vendedor — dispara a 2ª via (envelope do
 * vendedor/proprietário) manualmente, nas propostas em `aguardando_vendedor`.
 * Reusa `sendVendedorEnvelope` (a mesma que o webhook encadeia automaticamente):
 * idempotente (`@@unique[proposalId, via]`), no-op sem vendedor.
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

  // Resultado ESTRUTURADO: distingue o motivo real em vez de inferir por presença
  // de envelope (que escondia budget/lock atrás de um 422 "confira os dados").
  const result = await sendVendedorEnvelope(proposal.id).catch(
    (err): Awaited<ReturnType<typeof sendVendedorEnvelope>> => ({
      ok: false,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err),
    })
  );

  if (!result.ok) {
    switch (result.reason) {
      case "already":
        // Já enviado/em voo — idempotente, trata como sucesso.
        break;
      case "no_vendedor":
        return NextResponse.json(
          { error: "Esta proposta não tem vendedor/proprietário para acionar." },
          { status: 409 }
        );
      case "no_creds":
        return NextResponse.json(
          { error: "Conta ClickSign não configurada para esta imobiliária." },
          { status: 422 }
        );
      case "preflight":
        return NextResponse.json(
          {
            error:
              "Confira os dados do vendedor (nome completo, e-mail/telefone) e tente novamente.",
            detail: result.detail,
          },
          { status: 422 }
        );
      case "budget":
        return NextResponse.json(
          {
            error:
              "Orçamento mensal de assinaturas atingido — libere saldo ou ajuste o limite em Configurações.",
          },
          { status: 402 }
        );
      case "locked":
        return NextResponse.json(
          { error: "Envio ao vendedor já em andamento. Aguarde alguns segundos." },
          { status: 409 }
        );
      case "not_found":
        return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
      default:
        return NextResponse.json(
          { error: result.detail ?? "Falha ao enviar ao vendedor." },
          { status: 502 }
        );
    }
  }

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_SEND_COUNTERPARTY",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
