import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { updateSignerAction, removeSignerAction } from "@/lib/clicksign/signer-actions";
import { loadScopedPlanSigner } from "@/lib/proposals/scoped-signer";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  documentation: z.string().optional(),
});

/**
 * PATCH — edita contato do signatário enquanto não assinou.
 * DELETE — remove UM signatário.
 *
 * Resolve por `loadScopedPlanSigner` (2026-08): EnvelopeSigner (ações reais na
 * ClickSign, caminho original) com fallback pra linha de ProposalSigner (plano,
 * pré-envio / parada de decisão) — edição/remoção direta no banco, o envio
 * futuro usa a linha corrigida.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; signerId: string } }
) {
  const scoped = await loadScopedPlanSigner(req, params.id, params.signerId);
  if ("fail" in scoped) return scoped.fail;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  if (scoped.kind === "plan") {
    const s = scoped.signer;
    const next = {
      name: parsed.data.name?.trim() || s.name,
      email: parsed.data.email?.trim() || s.email,
      phone: parsed.data.phone?.trim() || s.phone,
      cpf: parsed.data.documentation?.trim() || s.cpf,
    };
    const updated = await prisma.proposalSigner.update({
      where: { id: s.id },
      data: {
        ...next,
        // Identidade mudou → dedupeKey re-derivado (o backstop @@unique segue
        // valendo; colisão explode P2002 e o handler global devolve 500 — raro
        // o bastante pra não merecer tratamento dedicado aqui).
        dedupeKey: computeDedupeKey(next),
      },
    });
    await audit(
      extractAuditContextFromRequest(req, scoped.auth.org.id, scoped.auth.actor.effectiveUserId),
      { action: "PROPOSAL_UPDATE", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { planSignerId: s.id, edited: Object.keys(parsed.data) } }
    ).catch(() => {});
    return NextResponse.json({ ok: true, signer: { id: updated.id, name: updated.name } });
  }

  const result = await updateSignerAction(scoped.signer, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await audit(
    extractAuditContextFromRequest(req, scoped.auth.org.id, scoped.auth.actor.effectiveUserId),
    { action: "PROPOSAL_UPDATE", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { signerId: params.signerId, edited: Object.keys(parsed.data) } }
  ).catch(() => {});
  return NextResponse.json({ ok: true, signer: result.data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; signerId: string } }
) {
  const scoped = await loadScopedPlanSigner(req, params.id, params.signerId);
  if ("fail" in scoped) return scoped.fail;

  if (scoped.kind === "plan") {
    await prisma.proposalSigner.delete({ where: { id: scoped.signer.id } });
    await audit(
      extractAuditContextFromRequest(req, scoped.auth.org.id, scoped.auth.actor.effectiveUserId),
      { action: "PROPOSAL_UPDATE", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { removed: "plan_signer", planSignerId: scoped.signer.id } }
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const result = await removeSignerAction(scoped.signer);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await audit(
    extractAuditContextFromRequest(req, scoped.auth.org.id, scoped.auth.actor.effectiveUserId),
    { action: "PROPOSAL_CANCEL", result: "SUCCESS", resource: params.id, resourceType: "Proposal", metadata: { signerId: params.signerId, scope: "signer" } }
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
