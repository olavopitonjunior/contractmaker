import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { isValidEmail } from "@/lib/clicksign/mapping";
import { addSignerToEnvelope } from "@/lib/clicksign/signer-actions";
import type { ClicksignRole } from "@/lib/clicksign/roles";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

const addSchema = z.object({
  name: z.string().min(2),
  email: z.string().refine((v) => isValidEmail(v), "E-mail inválido"),
  documentation: z.string().optional(),
  phone: z.string().optional(),
  sourceKind: z.string().default("outro"),
  sourceIndex: z.number().int().min(0).default(0),
  role: z.string().optional(),
  group: z.number().int().min(1).optional(),
});

/**
 * POST — adiciona signatário a um envelope de proposta JÁ CRIADO.
 *
 * Distinto de `POST /api/proposals/[id]/signers`, que cria a linha de plano
 * (`ProposalSigner`) antes do envio. `addSignerToEnvelope` cuida do caso
 * `running` via `bulk_requirements`, único caminho pós-ativação da v3.
 *
 * Exige PROPOSAL_SEND: signatário novo é custo novo na ClickSign.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, orgId: auth.org.id },
  });
  if (!envelope || envelope.proposalId !== params.id) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }

  const result = await addSignerToEnvelope(envelope, {
    name: parsed.data.name,
    email: parsed.data.email,
    documentation: parsed.data.documentation,
    phone: parsed.data.phone,
    sourceKind: parsed.data.sourceKind,
    sourceIndex: parsed.data.sourceIndex,
    role: parsed.data.role as ClicksignRole | undefined,
    group: parsed.data.group ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ signer: result.data }, { status: 201 });
}
