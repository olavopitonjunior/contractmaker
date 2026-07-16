import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal } from "@/lib/security/rbac/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proposals/[id]/status — leitura RÁPIDA do estado atual pra polling em
 * tempo real (não chama a ClickSign; lê o DB que o webhook atualiza em ~1-3s).
 * Retorna o status da proposta + o status por signatário (dos EnvelopeSigner,
 * onde vive o sign/view real) + dossiê/conversão. Alvo do `useProposalPolling`.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const proposal = await prisma.proposal.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orgId: true,
      userId: true,
      status: true,
      dossierUrl: true,
      convertedDealId: true,
      updatedAt: true,
    },
  });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId })) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }

  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: params.id, status: { notIn: ["failed"] } },
    select: {
      id: true,
      via: true,
      status: true,
      signers: {
        select: {
          id: true,
          name: true,
          role: true,
          notifyChannel: true,
          status: true,
          signingGroup: true,
          viewedAt: true,
          signedAt: true,
          refusedAt: true,
        },
        orderBy: { signingGroup: "asc" },
      },
    },
    orderBy: { via: "asc" },
  });

  const signers = envelopes.flatMap((e) =>
    e.signers.map((s) => ({
      id: s.id,
      via: e.via,
      name: s.name,
      role: s.role,
      channel: s.notifyChannel,
      status: s.status,
      signingGroup: s.signingGroup,
      viewedAt: s.viewedAt?.toISOString() ?? null,
      signedAt: s.signedAt?.toISOString() ?? null,
      refusedAt: s.refusedAt?.toISOString() ?? null,
    }))
  );

  // "Ativo" = ainda há algo esperando (pra o hook saber quando parar de pollar).
  const active =
    envelopes.some((e) => e.status === "running") &&
    !["completa", "convertida", "cancelada", "expirada", "recusada_proponente", "recusada_vendedor"].includes(
      proposal.status
    );

  return NextResponse.json({
    status: proposal.status,
    dossierUrl: proposal.dossierUrl,
    convertedDealId: proposal.convertedDealId,
    envelopes: envelopes.map((e) => ({ id: e.id, via: e.via, status: e.status })),
    signers,
    active,
    updatedAt: proposal.updatedAt.toISOString(),
  });
}
