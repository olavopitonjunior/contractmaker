import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { proposalFeatureForKind } from "@/lib/modules/catalog";
import { requireApproval, approvalResponse } from "@/lib/api/intents";
import { ensureIntentExecutorsRegistered } from "@/lib/api/intent-executors";
import { executeProposalSend, blockToResponse } from "@/lib/proposals/send-execute";

/**
 * POST /api/proposals/[id]/send — envia pra assinatura (envelope) ou Aceite via
 * WhatsApp, decidido pela capacidade da conta. High-risk (gasta): session
 * executa; Bearer (Max) → ActionIntent.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  ensureIntentExecutorsRegistered();
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const proposal = await prisma.proposal.findUnique({ where: { id: params.id } });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId })) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }
  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await assertFeatureEnabled(auth.org.id, proposalFeatureForKind(proposal.kind));
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
  if (!["rascunho", "aguardando_aprovacao", "falha_envio"].includes(proposal.status)) {
    return NextResponse.json(
      { error: "Esta proposta já foi enviada." },
      { status: 409 }
    );
  }

  const result = await requireApproval<unknown>({
    ctx: auth,
    action: "PROPOSAL_SEND",
    payload: { proposalId: params.id },
    preview: {
      summary: `Enviar a proposta "${proposal.title}" para assinatura`,
      details: { proposalId: params.id, kind: proposal.kind },
    },
    req,
    idempotencyKey: req.headers.get("x-idempotency-key"),
    run: async () => {
      const r = await executeProposalSend(params.id);
      if (!r.ok) return blockToResponse(r.block);
      return { status: 200, body: { ok: true, instrument: r.instrument } };
    },
  });
  return approvalResponse(result);
}
