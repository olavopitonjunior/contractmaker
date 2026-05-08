import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * DELETE /api/deals/:dealId/envelopes/:envelopeId
 *
 * Cancela qualquer envelope do deal — funciona pra Contract-based e
 * Attachment-based. Espelha a guarda de auth do endpoint contract-level
 * mas valida a relação Envelope→Deal em vez de Envelope→Contract.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, dealId: params.dealId },
    include: { deal: { include: { pipeline: { select: { orgId: true } } } } },
  });
  if (!envelope) {
    return NextResponse.json(
      { error: "Envelope não encontrado" },
      { status: 404 }
    );
  }
  if (envelope.deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await cancelEnvelopeFlow(envelope.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}`, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deals envelope DELETE] erro:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
