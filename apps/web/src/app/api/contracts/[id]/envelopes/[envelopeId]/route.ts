import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cancelEnvelopeFlow } from "@/lib/clicksign/executor";
import { updateEnvelope } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

async function loadEnvelope(envelopeId: string, orgId: string) {
  return prisma.envelope.findFirst({
    where: { id: envelopeId, orgId },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
      events: { orderBy: { receivedAt: "desc" }, take: 50 },
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const envelope = await loadEnvelope(params.envelopeId, authResult.ctx.orgId);
  if (!envelope || envelope.contractId !== params.id) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ envelope });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await loadEnvelope(params.envelopeId, authResult.ctx.orgId);
  if (!envelope || envelope.contractId !== params.id) {
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;

  const envelope = await loadEnvelope(params.envelopeId, authResult.ctx.orgId);
  if (!envelope || envelope.contractId !== params.id) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  if (envelope.status === "closed") {
    return NextResponse.json(
      { error: "Envelope já finalizado" },
      { status: 400 }
    );
  }
  if (envelope.status === "canceled") {
    return NextResponse.json({ ok: true, alreadyCanceled: true });
  }
  try {
    await cancelEnvelopeFlow(envelope.id);
  } catch (err) {
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}` },
        { status: 502 }
      );
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
