import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { getEffectivePermissions, canAccessProposal } from "@/lib/security/rbac/check";
import { sanitizeHiddenPaths } from "@/lib/proposals/hidden-fields";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

async function loadScoped(req: NextRequest, id: string) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal || proposal.orgId !== auth.org.id) {
    return { fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };
  }
  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId })) {
    // 404 (não 403) pra não vazar existência a quem não tem escopo.
    return { fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };
  }
  return { auth, proposal };
}

// GET /api/proposals/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScoped(req, params.id);
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
  const r = await loadScoped(req, params.id);
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
