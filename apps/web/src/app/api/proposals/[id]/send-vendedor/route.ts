import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
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

  try {
    await sendVendedorEnvelope(proposal.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao enviar ao vendedor." },
      { status: 502 }
    );
  }

  // Confirma que a via reduzida foi criada (ou já existia). Se não, distingue o
  // motivo: sem vendedor (409) vs vendedor com dados inválidos que a
  // sendVendedorEnvelope abortou no preflight sem lançar (422 acionável) — em vez
  // de um 409 genérico "sem vendedor ou já processado" que impede o diagnóstico.
  const env = await prisma.envelope.findFirst({
    where: { proposalId: proposal.id, via: "reduzida", status: { in: ["running", "closed"] } },
    select: { id: true },
  });
  if (!env) {
    const vendedores = await prisma.proposalSigner.count({
      where: { proposalId: proposal.id, included: true, role: "vendedor" },
    });
    if (vendedores === 0) {
      return NextResponse.json(
        { error: "Esta proposta não tem vendedor/proprietário para acionar." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar ao vendedor — confira os dados do vendedor (nome completo, e-mail/telefone) e tente novamente.",
      },
      { status: 422 }
    );
  }

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_SEND_COUNTERPARTY",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { envelopeId: env.id },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, envelopeId: env.id });
}
