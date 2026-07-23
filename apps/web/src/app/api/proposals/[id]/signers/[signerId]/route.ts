import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateSignerAction, removeSignerAction } from "@/lib/clicksign/signer-actions";
import { loadScopedProposalSigner } from "@/lib/proposals/scoped-signer";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  documentation: z.string().optional(),
});

/** PATCH — edita contato do signatário (nome/e-mail/telefone) enquanto não assinou. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; signerId: string } }
) {
  const scoped = await loadScopedProposalSigner(req, params.id, params.signerId);
  if ("fail" in scoped) return scoped.fail;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
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

/** DELETE — remove/cancela UM signatário (proponente errado) enquanto não assinou. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; signerId: string } }
) {
  const scoped = await loadScopedProposalSigner(req, params.id, params.signerId);
  if ("fail" in scoped) return scoped.fail;

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
