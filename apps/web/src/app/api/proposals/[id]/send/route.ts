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

// Único endpoint de proposta que roda Chromium (PDF) + 2+3N chamadas ClickSign
// sequenciais. Sem maxDuration, o default da plataforma matava o envio no meio:
// claim já em "enviada", envelope draft órfão, ninguém notificado (classe do
// bug "draft órfão" do BUGS.md).
export const runtime = "nodejs";
export const maxDuration = 60;

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
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId, responsibleUserId: proposal.responsibleUserId })) {
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
    // Pedir o envio JÁ É a autorização. O corretor que diz "manda a proposta"
    // pelo WhatsApp não tem como aprovar uma ActionIntent — a aprovação vive na
    // tela do app —, então o pedido dele ficava `pending` e expirava em 24h sem
    // nada acontecer, o que ele lê como "o Newton não faz". A intent continua
    // gravada (quem pediu, payload, resultado) e a idempotencyKey segue
    // impedindo envio duplicado; some só o segundo humano.
    autoApprove: true,
    run: async () => {
      const r = await executeProposalSend(params.id);
      if (!r.ok) return blockToResponse(r.block);
      return {
        status: 200,
        body: {
          ok: true,
          instrument: r.instrument,
          // O envio pode ter sido rebaixado (assinatura → Aceite) ou ter usado
          // um default de capacidade não verificado. A UI precisa dizer isso.
          warnings: r.warnings ?? [],
          capabilitiesUnverified: r.capabilitiesUnverified ?? false,
        },
      };
    },
  });
  return approvalResponse(result);
}
