import { NextRequest, NextResponse } from "next/server";
import type { Proposal } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { certidoesFeatureForKind } from "@/lib/modules/catalog";
import { esteiraForDealKind, type CertidoesEsteira } from "./target-paths";

/**
 * Escopo das rotas de certidões da PROPOSTA (`/api/proposals/[id]/certidoes/**`).
 *
 * Espelha o `authorizeDeal` das rotas de Deal com o vocabulário da proposta:
 *  - `loadScopedProposal` (org + `canAccessProposal`, 404 fora do escopo);
 *  - feature da esteira (`vendas.certidoes` / `locacao.certidoes`) E a feature
 *    de propostas da esteira;
 *  - escrita (disparo, retry, delete…) exige `PROPOSAL_SEND` — quem envia a
 *    proposta é quem paga consulta por ela — e proposta encerrada não recebe
 *    consulta nova; `completa` (aceita, ainda não convertida) é justamente a
 *    hora de emitir. Convertida → o motor é o do negócio.
 */
export interface ProposalCertidoesScope {
  proposal: Proposal;
  orgId: string;
  userId: string;
  userEmail: string | null;
  esteira: CertidoesEsteira;
  dataJson: Record<string, unknown>;
}

/** Terminais que ainda aceitam certidão: só `completa`. */
const WRITE_BLOCKED = new Set([...TERMINAL_STATUSES].filter((s) => s !== "completa"));

export async function loadProposalCertidoesScope(
  req: NextRequest,
  id: string,
  opts: { write: boolean }
): Promise<{ fail: NextResponse } | { scope: ProposalCertidoesScope }> {
  const r = await loadScopedProposal(req, id);
  if ("fail" in r) return r;
  const { auth, eff, proposal } = r;

  if (opts.write && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return { fail: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return { fail: feat };
  const modulesView = await getOrgModules(auth.org.id);
  if (!isFeatureEnabled(modulesView, certidoesFeatureForKind(proposal.kind))) {
    return { fail: NextResponse.json({ error: "MODULE_DISABLED" }, { status: 403 }) };
  }
  if (opts.write && WRITE_BLOCKED.has(proposal.status)) {
    return {
      fail: NextResponse.json(
        { error: "Proposta encerrada não recebe certidões. Use o negócio convertido." },
        { status: 409 }
      ),
    };
  }

  // E-mail do operador → campo `email` dos jobs de tribunal (e-SAJ exige).
  const user = await prisma.user.findUnique({
    where: { id: auth.actor.effectiveUserId },
    select: { email: true },
  });

  return {
    scope: {
      proposal,
      orgId: auth.org.id,
      userId: auth.actor.effectiveUserId,
      userEmail: user?.email ?? null,
      esteira: esteiraForDealKind(proposal.kind),
      dataJson: (proposal.dataJson && typeof proposal.dataJson === "object"
        ? proposal.dataJson
        : {}) as Record<string, unknown>,
    },
  };
}

/** Base das rotas de certidões e de anexos da proposta (para a UI). */
export function proposalCertidoesBases(proposalId: string) {
  return {
    apiBase: `/api/proposals/${proposalId}/certidoes`,
    attachmentsBase: `/api/proposals/${proposalId}/attachments`,
  };
}
