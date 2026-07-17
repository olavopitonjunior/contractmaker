import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
import { convertProposalToDeal, ProposalConvertError } from "@/lib/proposals/convert";

const bodySchema = z.object({
  allowUnsigned: z.boolean().optional(),
  unsignedReason: z.string().optional(),
});

/**
 * POST /api/proposals/[id]/convert — cria Deal + SalesForm.
 * High-risk: session executa; Bearer (Max) → ActionIntent pra aprovação humana.
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
  if (!can(eff, PERMISSION.PROPOSAL_CONVERT)) {
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  // Converter sem assinatura exige motivo (fica no audit).
  if (parsed.data.allowUnsigned && !parsed.data.unsignedReason?.trim()) {
    return NextResponse.json(
      { error: "Informe o motivo para converter sem assinatura." },
      { status: 400 }
    );
  }

  const result = await requireApproval<unknown>({
    ctx: auth,
    action: "PROPOSAL_CONVERT",
    payload: {
      proposalId: params.id,
      allowUnsigned: parsed.data.allowUnsigned ?? false,
      unsignedReason: parsed.data.unsignedReason ?? null,
    },
    preview: {
      summary: `Converter a proposta "${proposal.title}" em negócio`,
      details: { proposalId: params.id, kind: proposal.kind, status: proposal.status },
    },
    req,
    idempotencyKey: req.headers.get("x-idempotency-key"),
    run: async () => {
      try {
        const r = await convertProposalToDeal({
          proposalId: params.id,
          orgId: auth.org.id,
          actorUserId: auth.actor.effectiveUserId,
          allowUnsigned: parsed.data.allowUnsigned,
          unsignedReason: parsed.data.unsignedReason,
        });
        return { status: 201, body: r };
      } catch (err) {
        if (err instanceof ProposalConvertError) {
          const status = err.code === "already_converted" ? 409 : 400;
          return { status, body: { error: err.message, code: err.code } };
        }
        throw err;
      }
    },
  });
  return approvalResponse(result);
}
