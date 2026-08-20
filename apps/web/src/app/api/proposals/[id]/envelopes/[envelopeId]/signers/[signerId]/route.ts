import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  resendSignerAction,
  updateSignerAction,
  removeSignerAction,
} from "@/lib/clicksign/signer-actions";
import { CLICKSIGN_ROLES } from "@/lib/clicksign/roles";
import { CLICKSIGN_AUTH_METHODS } from "@/lib/clicksign/types";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

/**
 * Ações por signatário DO ENVELOPE de uma proposta.
 *
 * Não confundir com `/api/proposals/[id]/signers/[signerId]`, que mexe no
 * `ProposalSigner` — a linha de PLANO, editável antes do envio. Aqui o alvo é o
 * `EnvelopeSigner`, que só existe depois que o envelope foi criado e é quem a
 * ClickSign conhece.
 *
 * O corpo do PATCH é a união discriminada `{action:"resend"|"update"}` de
 * propósito: é o contrato que o `<EnvelopeCard />` já fala (`PATCH
 * {basePath}/signers/{id}`), então o componente inteiro é reusado sem adaptador.
 */
async function loadSigner(
  envelopeId: string,
  signerId: string,
  orgId: string,
  proposalId: string
) {
  const signer = await prisma.envelopeSigner.findFirst({
    where: { id: signerId, envelopeId },
    include: { envelope: true },
  });
  if (!signer || signer.envelope.orgId !== orgId) return null;
  // Amarra o envelope à proposta da URL — senão um envelopeId/signerId de outra
  // proposta da mesma org passaria pelo escopo.
  if (signer.envelope.proposalId !== proposalId) return null;
  return signer;
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resend") }),
  z.object({
    action: z.literal("update"),
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().optional(),
    documentation: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v === "" || v.length === 11 || v.length === 14, {
        message: "CPF deve ter 11 dígitos ou CNPJ 14",
      })
      .optional(),
    phone: z.string().max(20).optional(),
    role: z.enum(CLICKSIGN_ROLES).optional(),
    authMethod: z.enum(CLICKSIGN_AUTH_METHODS).optional(),
  }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Reenviar pede PROPOSAL_RESEND; alterar o signatário pede PROPOSAL_SEND
  // (mexe em quem assina, não só em quando avisa).
  const needed =
    parsed.data.action === "resend" ? PERMISSION.PROPOSAL_RESEND : PERMISSION.PROPOSAL_SEND;
  if (!can(eff, needed)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    auth.org.id,
    params.id
  );
  if (!signer) {
    return NextResponse.json({ error: "Signatário não encontrado" }, { status: 404 });
  }

  const result =
    parsed.data.action === "resend"
      ? await resendSignerAction(signer)
      : await updateSignerAction(signer, parsed.data);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ signer: result.data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    auth.org.id,
    params.id
  );
  if (!signer) {
    return NextResponse.json({ error: "Signatário não encontrado" }, { status: 404 });
  }

  const result = await removeSignerAction(signer);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
