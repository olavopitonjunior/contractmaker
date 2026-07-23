import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import type { Prisma } from "@prisma/client";

type ScopedSigner = Prisma.EnvelopeSignerGetPayload<{ include: { envelope: true } }>;
// Ramo de sucesso do requireApiAuth (tem `org`/`actor`), já estreitado.
type ApiAuthOk = Extract<Awaited<ReturnType<typeof requireApiAuth>>, { org: object }>;

/**
 * Carrega o EnvelopeSigner ESCOPADO à proposta (anti-IDOR): o signatário tem de
 * pertencer a um envelope `source="proposal"` desta proposta, na org do ator,
 * com a proposta acessível e a permissão de escrita (PROPOSAL_SEND). Reusado
 * pelas rotas de editar/reenviar/remover signatário.
 */
export async function loadScopedProposalSigner(
  req: NextRequest,
  proposalId: string,
  signerId: string
): Promise<{ fail: NextResponse } | { auth: ApiAuthOk; signer: ScopedSigner }> {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const signer = await prisma.envelopeSigner.findUnique({
    where: { id: signerId },
    include: { envelope: true },
  });
  if (
    !signer ||
    signer.envelope.proposalId !== proposalId ||
    signer.envelope.orgId !== auth.org.id ||
    signer.envelope.source !== "proposal"
  ) {
    return { fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { userId: true, responsibleUserId: true },
  });
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (
    !proposal ||
    !eff ||
    !canAccessProposal({
      effective: eff,
      ownerUserId: proposal.userId,
      // Espelha loadScopedProposal: o responsável atribuído também acessa (senão
      // um corretor atribuído-mas-não-criador tomava 403 só nas rotas de signer).
      responsibleUserId: proposal.responsibleUserId,
    }) ||
    !can(eff, PERMISSION.PROPOSAL_SEND)
  ) {
    return { fail: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { auth: auth as ApiAuthOk, signer };
}
