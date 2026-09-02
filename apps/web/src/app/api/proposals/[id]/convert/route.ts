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
import { guardDealCreate } from "@/lib/deals/route-helpers";

const bodySchema = z.object({
  allowUnsigned: z.boolean().optional(),
  unsignedReason: z.string().optional(),
  // Gerente responsável do negócio criado (feature Gerente). Opcional — a
  // obrigatoriedade vem da org (422 gerente_obrigatorio).
  managerUserId: z.string().min(1).optional(),
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
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId, responsibleUserId: proposal.responsibleUserId })) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }
  if (!can(eff, PERMISSION.PROPOSAL_CONVERT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Converter CRIA um negócio — então cobra também a permissão de CRIAR, a
  // mesma das seis rotas de criação fechadas no #513. Esta era a sétima porta:
  // gateada só por PROPOSAL_CONVERT, ela deixava o admin que desliga "Criar
  // negócio de venda" em /settings/gerentes ler a tela como fechada enquanto o
  // gerente seguia criando negócio por aqui — um controle que mente (#514).
  //
  // Condicional por `kind` porque a rota é polimórfica: `convertProposalToDeal`
  // resolve o pipeline com `getPipelineByKind(proposal.kind)` e grava
  // `Deal.kind = proposal.kind`. Cobrar DEAL_CREATE ("criar negócio de venda")
  // para converter uma proposta de locação seria o rótulo errado.
  const deniedCreate = await guardDealCreate({
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
    permission:
      proposal.kind === "locacao"
        ? PERMISSION.LEASE_CREATE
        : PERMISSION.DEAL_CREATE,
  });
  if (deniedCreate) return deniedCreate;
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
      managerUserId: parsed.data.managerUserId ?? null,
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
          managerUserId: parsed.data.managerUserId,
        });
        return { status: 201, body: r };
      } catch (err) {
        if (err instanceof ProposalConvertError) {
          // Mesmos códigos HTTP dos endpoints de criação: 422 quando a org
          // exige gerente e ele não veio; 409 na corrida de conversão.
          const status =
            err.code === "already_converted"
              ? 409
              : err.code === "gerente_obrigatorio"
                ? 422
                : 400;
          return { status, body: { error: err.message, code: err.code } };
        }
        throw err;
      }
    },
  });
  return approvalResponse(result);
}
