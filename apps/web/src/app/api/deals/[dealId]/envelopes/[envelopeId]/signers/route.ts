import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { isValidEmail } from "@/lib/clicksign/mapping";
import { addSignerToEnvelope } from "@/lib/clicksign/signer-actions";
import type { ClicksignRole } from "@/lib/clicksign/roles";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

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

/** POST /api/deals/[dealId]/envelopes/[envelopeId]/signers — adiciona
 *  signatário a um envelope avulso (documento da pasta). */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, dealId: params.dealId, orgId: ctx.orgId },
  });
  if (!envelope) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }

  // Escopo do gerente + ENVELOPE_SEND (signatário novo = custo novo).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
    permission: PERMISSION.ENVELOPE_SEND,
  });
  if (denied) return denied;

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
