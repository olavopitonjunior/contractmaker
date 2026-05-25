import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { updateEnvelope } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

/**
 * PATCH /api/deals/:dealId/envelopes/:envelopeId — edita nome/prazo do
 * envelope (draft/running). Espelha o contract-level, guardando por deal.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, dealId: params.dealId, orgId: ctx.orgId },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
    },
  });
  if (!envelope) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  if (envelope.status !== "draft" && envelope.status !== "running") {
    return NextResponse.json(
      { error: "Envelope não pode mais ser editado" },
      { status: 400 }
    );
  }
  if (envelope.status === "running" && parsed.data.name !== undefined) {
    return NextResponse.json(
      { error: "Não é possível alterar o nome de envelope em andamento" },
      { status: 400 }
    );
  }

  const deadlineAt =
    parsed.data.deadlineAt === undefined
      ? undefined
      : parsed.data.deadlineAt === null
        ? null
        : new Date(parsed.data.deadlineAt);

  if (envelope.clicksignId) {
    try {
      await updateEnvelope({
        envelopeId: envelope.clicksignId,
        name: parsed.data.name,
        deadlineAt,
      });
    } catch (err) {
      if (err instanceof ClicksignError) {
        return NextResponse.json(
          { error: `Clicksign: ${err.message}` },
          { status: 502 }
        );
      }
      throw err;
    }
  }

  const updated = await prisma.envelope.update({
    where: { id: envelope.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
    },
  });
  return NextResponse.json({ envelope: updated });
}

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
