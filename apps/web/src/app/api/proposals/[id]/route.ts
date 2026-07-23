import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { DELETABLE_STATUSES } from "@/lib/proposals/status-sets";
import { sanitizeHiddenPaths } from "@/lib/proposals/hidden-fields";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

// GET /api/proposals/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const [signers, events, attachments, envelopes] = await Promise.all([
    prisma.proposalSigner.findMany({ where: { proposalId: params.id } }),
    prisma.proposalEvent.findMany({
      where: { proposalId: params.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.proposalAttachment.findMany({ where: { proposalId: params.id } }),
    prisma.envelope.findMany({
      where: { proposalId: params.id },
      include: { signers: true },
    }),
  ]);
  return NextResponse.json({ proposal: r.proposal, signers, events, attachments, envelopes });
}

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  dataJson: z.record(z.unknown()).optional(),
  validUntil: z.string().datetime().nullable().optional(),
  comissaoIncluida: z.boolean().optional(),
  hiddenPaths: z.array(z.string()).optional(),
});

// PATCH /api/proposals/[id] — só em rascunho.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  if (r.proposal.status !== "rascunho") {
    return NextResponse.json(
      { error: "Só é possível editar uma proposta em rascunho." },
      { status: 409 }
    );
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;
  const updated = await prisma.proposal.update({
    where: { id: params.id },
    data: {
      ...(p.title !== undefined ? { title: p.title } : {}),
      ...(p.dataJson !== undefined
        ? { dataJson: p.dataJson as Prisma.InputJsonValue }
        : {}),
      ...(p.validUntil !== undefined
        ? { validUntil: p.validUntil ? new Date(p.validUntil) : null }
        : {}),
      ...(p.comissaoIncluida !== undefined ? { comissaoIncluida: p.comissaoIncluida } : {}),
      // hiddenPaths sempre sanitizado contra a allowlist do schemaType.
      ...(p.hiddenPaths !== undefined
        ? { hiddenPaths: sanitizeHiddenPaths(r.proposal.schemaType, p.hiddenPaths) }
        : {}),
    },
  });
  await audit(
    extractAuditContextFromRequest(req, r.auth.org.id, r.auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_UPDATE",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "Proposal",
    }
  ).catch(() => {});
  return NextResponse.json({ proposal: updated });
}

// DELETE /api/proposals/[id] — exclui a proposta (cascata remove signers/events/
// attachments/envelopes). Só em estado frio e nunca depois de virar negócio.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_DELETE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (proposal.convertedDealId) {
    return NextResponse.json(
      { error: "Proposta já virou negócio; exclua o negócio no pipeline." },
      { status: 409 }
    );
  }
  if (!DELETABLE_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Cancele a assinatura antes de excluir." },
      { status: 409 }
    );
  }
  // Invariante da plataforma (igual ao delete de contrato): nunca excluir com um
  // Envelope ClickSign ainda VIVO — a cascata apagaria a linha local mas deixaria
  // o envelope ativo e cobrável na ClickSign, e assinaturas/webhooks posteriores
  // não resolveriam mais a proposta. Ex.: 'expirada' (o cron marca o status mas o
  // envelope pode seguir running) ou 'recusada_proponente' com o vendedor ainda
  // pendente. Cancele primeiro (POST /cancel cancela o remoto).
  const liveEnvelope = await prisma.envelope.findFirst({
    where: { proposalId: params.id, status: "running", clicksignId: { not: null } },
    select: { id: true },
  });
  if (liveEnvelope) {
    return NextResponse.json(
      { error: "Cancele a assinatura antes de excluir." },
      { status: 409 }
    );
  }

  await prisma.proposal.delete({ where: { id: params.id } });
  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_DELETE",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "Proposal",
      metadata: { status: proposal.status, title: proposal.title },
    }
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
