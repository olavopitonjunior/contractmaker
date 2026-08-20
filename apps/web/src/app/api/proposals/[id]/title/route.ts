import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
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
 * Permissão: escopo NÃO basta. `loadScopedProposal` libera quem tem
 * `PROPOSAL_VIEW_ALL`, e esse é exatamente o recorte do papel `viewer`
 * (rbac/roles.ts): vê todas as propostas da org e não produz nenhuma — sem
 * CREATE, SEND ou CANCEL. Sem a checagem abaixo, o papel explicitamente
 * somente-leitura renomeava qualquer proposta em curso, com a UI oferecendo o
 * botão. Não existe PROPOSAL_UPDATE, então o corte é quem pode criar OU
 * enviar: quem produz a proposta pode rebatizá-la.
 *
 * O teste desta rota varre TODOS os presets em vez de fixar `viewer`, porque o
 * que abre o buraco é a forma da permissão (VIEW_ALL sem CREATE/SEND), não o
 * rótulo — um preset novo de auditoria ou portal cairia nele em silêncio.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_CREATE) && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
