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
import { ClicksignError } from "@/lib/clicksign/client";
import { syncEnvelopeState, EnvelopeNotSyncableError } from "@/lib/clicksign/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposals/[id]/sync — reconcilia os envelopes da proposta contra o
 * feed REST /events da ClickSign (mesma lógica do botão Atualizar de contratos),
 * e propaga o desfecho pro status da proposta. Redundância do webhook + único
 * caminho que surfacer `email_failed` (bounce, que a ClickSign não manda por
 * webhook). `?debug=1` devolve os shapes crus pra diagnóstico.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  // /sync dispara chamadas REST à ClickSign + muta status → é ação de escrita,
  // não de leitura. Antes um viewer (só PROPOSAL_VIEW_ALL) passava e acionava
  // efeitos colaterais. Exige a mesma permissão do envio.
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

  const debug = new URL(req.url).searchParams.get("debug") === "1";

  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: params.id, status: { notIn: ["failed"] }, clicksignId: { not: null } },
    include: { signers: true },
  });

  const results: unknown[] = [];
  for (const env of envelopes) {
    try {
      // A propagação pro status da proposta (close/recusa/cancel + sinos) vive
      // dentro do syncEnvelopeState — mesmo caminho do cron e do webhook.
      const result = await syncEnvelopeState(env, { actorVia: "proposal-sync", debug });
      results.push({ envelopeId: env.id, via: env.via, ...result });
    } catch (err) {
      if (err instanceof EnvelopeNotSyncableError) {
        results.push({ envelopeId: env.id, error: err.message });
      } else if (err instanceof ClicksignError) {
        results.push({ envelopeId: env.id, error: `Clicksign: ${err.message}`, status: err.status });
      } else {
        results.push({ envelopeId: env.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const fresh = await prisma.proposal.findUnique({
    where: { id: params.id },
    select: { status: true },
  });
  return NextResponse.json({ status: fresh?.status, envelopes: results });
}
