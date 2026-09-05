import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { reconcileCreditRequest, submitCreditRequest } from "@/lib/credit/fichacerta-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/:id/credit/analysis/:requestId/sync — "Atualizar":
 * reconcilia agora com a Ficha Certa (GET report), sem esperar webhook/cron.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; requestId: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;
  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const request = await prisma.creditAnalysisRequest.findUnique({ where: { id: params.requestId } });
  if (!request || request.proposalId !== proposal.id || request.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
  }
  if (request.status === "pending") {
    // Envio pendente (falha transitória anterior): "Atualizar" tenta de novo
    // agora em vez de esperar o cron.
    await submitCreditRequest(request.id);
  } else if (request.status === "processing" || request.status === "completed") {
    await reconcileCreditRequest(request.id, { source: "manual" });
  }
  const fresh = await prisma.creditAnalysisRequest.findUnique({
    where: { id: request.id },
    select: { id: true, status: true, lastSyncedAt: true, errorMessage: true, completedAt: true },
  });
  return NextResponse.json({ ok: true, request: fresh });
}
