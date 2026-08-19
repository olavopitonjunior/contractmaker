import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
});

/**
 * PATCH /api/proposals/[id]/title — renomeia a proposta.
 *
 * Rota SEPARADA do PATCH /api/proposals/[id] de propósito: aquele é o editor de
 * conteúdo e para em `EDITABLE_STATUSES` (nada muda depois que o documento foi
 * congelado no envio). O título não é conteúdo — é o rótulo pelo qual a
 * imobiliária acha a proposta na lista, e travá-lo no envio deixaria toda
 * proposta em curso presa a um nome automático.
 *
 * O corte fica nos TERMINAIS: proposta convertida/recusada/expirada/cancelada/
 * completa é registro histórico e não se mexe.
 *
 * Não renomeia o envelope já criado na ClickSign — o nome de lá foi congelado
 * no envio, junto do documento que as pessoas viram.
 *
 * Permissão: só o escopo de `loadScopedProposal` (criador OU responsável OU
 * quem tem VIEW_ALL), igual ao PATCH principal — não existe PROPOSAL_UPDATE.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, proposal } = r;

  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  if (TERMINAL_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Proposta encerrada não pode ser renomeada." },
      { status: 409 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { title } = parsed.data;

  if (title === proposal.title) {
    return NextResponse.json({ ok: true, id: proposal.id, title });
  }

  // Guard ATÔMICO: entre o check acima e este update a proposta pode ter virado
  // terminal (webhook de recusa, cron de expiração). `updateMany` com o status
  // no where transforma essa corrida num 409 em vez de uma escrita fora de hora.
  const claimed = await prisma.proposal.updateMany({
    where: { id: proposal.id, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { title },
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "Proposta encerrada não pode ser renomeada." },
      { status: 409 }
    );
  }

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "renamed",
        source: "system",
        payload: { from: proposal.title, to: title },
      },
    })
    .catch(() => {});

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_RENAME",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { from: proposal.title, to: title },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, id: proposal.id, title });
}
