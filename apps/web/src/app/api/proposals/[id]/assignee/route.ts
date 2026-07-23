import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

// Um dos três, mutuamente exclusivo: usuário da plataforma, nome livre, ou limpar.
const bodySchema = z.object({
  responsibleUserId: z.string().min(1).optional(),
  responsibleName: z.string().min(2).max(120).optional(),
  clear: z.boolean().optional(),
});

/**
 * PATCH /api/proposals/[id]/assignee — define/troca o responsável comercial.
 * `responsibleUserId` (usuário) e `responsibleName` (nome livre de não-usuário)
 * são mutuamente exclusivos: setar um zera o outro. `clear:true` remove ambos.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_ASSIGN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Feature gate (vendas.propostas / locacao.propostas) — igual a cancel/remind/
  // send-vendedor; sem isto uma org com o módulo desligado ainda reatribuía.
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { responsibleUserId, responsibleName, clear } = parsed.data;
  const provided = [responsibleUserId, responsibleName, clear ? "clear" : undefined].filter(
    (v) => v != null
  );
  if (provided.length !== 1) {
    return NextResponse.json(
      { error: "Informe exatamente um: responsibleUserId, responsibleName ou clear." },
      { status: 400 }
    );
  }

  let data: { responsibleUserId: string | null; responsibleName: string | null };
  if (clear) {
    data = { responsibleUserId: null, responsibleName: null };
  } else if (responsibleUserId) {
    // Só membros da org podem ser responsáveis-usuário.
    const member = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: responsibleUserId, orgId: auth.org.id } },
      select: { userId: true },
    });
    if (!member) {
      return NextResponse.json(
        { error: "Usuário não é membro desta organização." },
        { status: 400 }
      );
    }
    data = { responsibleUserId, responsibleName: null };
  } else {
    data = { responsibleUserId: null, responsibleName: responsibleName ?? null };
  }

  const updated = await prisma.proposal.update({
    where: { id: proposal.id },
    data,
    select: { id: true, responsibleUserId: true, responsibleName: true },
  });

  await prisma.proposalEvent
    .create({
      data: { proposalId: proposal.id, eventName: "assignee_changed", source: "system" },
    })
    .catch(() => {});

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_ASSIGN",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: {
        responsibleUserId: updated.responsibleUserId,
        responsibleName: updated.responsibleName,
      },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, ...updated });
}
