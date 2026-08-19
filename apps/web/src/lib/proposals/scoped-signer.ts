import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { TERMINAL_STATUSES } from "./status-sets";
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

type PlanSigner = Prisma.ProposalSignerGetPayload<object>;

export type ScopedPlanSignerResult =
  | { fail: NextResponse }
  | { auth: ApiAuthOk; kind: "envelope"; signer: ScopedSigner }
  | { auth: ApiAuthOk; kind: "plan"; signer: PlanSigner };

/**
 * Variante com FALLBACK EnvelopeSigner → ProposalSigner (2026-08): as linhas
 * de plano (pré-envio e as adicionadas na parada de decisão) não têm envelope,
 * então o loader original 404-ava PATCH/DELETE nelas. Tenta o EnvelopeSigner
 * (caminho original, ações na ClickSign); não achou → resolve a linha de
 * ProposalSigner com o MESMO escopo anti-IDOR (proposta da org + acessível +
 * PROPOSAL_SEND).
 */
export async function loadScopedPlanSigner(
  req: NextRequest,
  proposalId: string,
  signerId: string,
  action: "edit" | "remove"
): Promise<ScopedPlanSignerResult> {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true, userId: true, responsibleUserId: true, status: true },
  });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return { fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (
    !eff ||
    !canAccessProposal({
      effective: eff,
      ownerUserId: proposal.userId,
      responsibleUserId: proposal.responsibleUserId,
    }) ||
    !can(eff, PERMISSION.PROPOSAL_SEND)
  ) {
    return { fail: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const envelopeSigner = await prisma.envelopeSigner.findUnique({
    where: { id: signerId },
    include: { envelope: true },
  });
  if (envelopeSigner) {
    if (
      envelopeSigner.envelope.proposalId === proposalId &&
      envelopeSigner.envelope.orgId === auth.org.id &&
      envelopeSigner.envelope.source === "proposal"
    ) {
      return { auth: auth as ApiAuthOk, kind: "envelope", signer: envelopeSigner };
    }
    // EnvelopeSigner existe mas está fora do escopo → 404 explícito (paridade
    // com loadScopedProposalSigner). Cair no lookup de plano mascararia a
    // tentativa cross-escopo sem deixar rastro do porquê.
    return { fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }

  const planSigner = await prisma.proposalSigner.findUnique({ where: { id: signerId } });
  if (!planSigner || planSigner.proposalId !== proposalId) {
    return { fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }
  // Terminal: nada muda mais (paridade com o guard do POST /signers).
  if (TERMINAL_STATUSES.has(proposal.status)) {
    return {
      fail: NextResponse.json(
        { error: `Signatários não podem ser alterados com a proposta em "${proposal.status}".` },
        { status: 409 }
      ),
    };
  }
  // Linha com termo de Aceite emitido é a ÂNCORA do webhook (identidade por
  // acceptanceClicksignId) e a prova por-signatário (acceptedAt/refusedAt):
  //  - termo VIVO (sent/completed): nunca editar/apagar — mudar contato não
  //    reemite nada (falso conserto) e apagar faz o próximo webhook cair no
  //    fallback isProponente=true (recusa do proprietário viraria
  //    recusada_proponente; expiração dele expiraria a proposta inteira).
  //  - termo MORTO (expired/canceled): EDITAR é permitido — é o único jeito de
  //    corrigir o contato errado antes da reemissão (sendVendedorAceiteLocked
  //    reemite termo morto com os dados atuais da linha). REMOVER continua
  //    bloqueado: um webhook tardio desse termo ainda resolve por esta linha.
  if (planSigner.acceptanceClicksignId) {
    const dead =
      planSigner.acceptanceStatus === "expired" || planSigner.acceptanceStatus === "canceled";
    if (!dead || action === "remove") {
      return {
        fail: NextResponse.json(
          {
            error: dead
              ? "Este signatário tem um termo expirado/cancelado — corrija os dados e reenvie a via (o termo é reemitido); a linha não pode ser removida."
              : "Este signatário já tem termo de aceite em andamento — a linha não pode ser editada nem removida enquanto o termo estiver ativo.",
          },
          { status: 409 }
        ),
      };
    }
  }
  return { auth: auth as ApiAuthOk, kind: "plan", signer: planSigner };
}
