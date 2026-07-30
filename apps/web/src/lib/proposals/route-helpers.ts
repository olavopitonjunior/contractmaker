import { NextRequest, NextResponse } from "next/server";
import type { Proposal } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
  type ApiAuthSuccess,
} from "@/lib/api/require-auth";
import {
  getEffectivePermissions,
  canAccessProposal,
  type EffectivePermissions,
} from "@/lib/security/rbac/check";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { proposalFeatureForKind } from "@/lib/modules/catalog";

/**
 * Carrega uma proposta já com auth + scope (org + `canAccessProposal` que aceita
 * criador OU responsável atribuído). Retorna 404 (não 403) fora do escopo, pra
 * não vazar existência. Base compartilhada de TODA rota `/[id]/*` de proposta —
 * cada caller faz o `can(eff, PERM)` específico depois.
 */
export async function loadScopedProposal(
  req: NextRequest,
  id: string
): Promise<
  | { fail: NextResponse }
  | { auth: ApiAuthSuccess; eff: EffectivePermissions; proposal: Proposal }
> {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return { fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  // Gerente: a proposta já convertida no negócio dele também é dele. Query
  // extra só quando há deal convertido (a esmagadora maioria não tem).
  const convertedDealManagerUserId = proposal.convertedDealId
    ? (
        await prisma.deal.findUnique({
          where: { id: proposal.convertedDealId },
          select: { managerUserId: true },
        })
      )?.managerUserId ?? null
    : null;
  if (
    !eff ||
    !canAccessProposal({
      effective: eff,
      ownerUserId: proposal.userId,
      responsibleUserId: proposal.responsibleUserId,
      convertedDealManagerUserId,
    })
  ) {
    return { fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };
  }
  return { auth, eff, proposal };
}

/**
 * Gate de feature (vendas.propostas / locacao.propostas). Retorna a resposta 403
 * `MODULE_DISABLED` quando desligada, ou `null` quando ok (segue o fluxo).
 */
export async function proposalFeatureGuard(
  orgId: string,
  kind: string
): Promise<NextResponse | null> {
  try {
    await assertFeatureEnabled(orgId, proposalFeatureForKind(kind));
    return null;
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
