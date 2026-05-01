import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { notifySigner, removeSigner } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";

const RESEND_COOLDOWN_MS = 60 * 60 * 1000; // 1h
const MAX_RESENDS = 5;

async function loadSigner(
  envelopeId: string,
  signerId: string,
  orgId: string,
  contractId: string
) {
  const signer = await prisma.envelopeSigner.findFirst({
    where: { id: signerId, envelopeId },
    include: { envelope: true },
  });
  if (!signer || signer.envelope.orgId !== orgId) return null;
  if (signer.envelope.contractId !== contractId) return null;
  return signer;
}

const patchSchema = z.object({
  action: z.enum(["resend"]),
});

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    ctx.orgId,
    params.id
  );
  if (!signer) {
    return NextResponse.json(
      { error: "Signatário não encontrado" },
      { status: 404 }
    );
  }
  if (signer.status === "signed" || signer.status === "removed") {
    return NextResponse.json(
      { error: "Signatário não pode ser reenviado neste estado" },
      { status: 400 }
    );
  }
  if (signer.resendCount >= MAX_RESENDS) {
    return NextResponse.json(
      { error: `Limite de ${MAX_RESENDS} reenvios atingido` },
      { status: 429 }
    );
  }
  if (
    signer.lastResendAt &&
    Date.now() - signer.lastResendAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    const wait = Math.ceil(
      (RESEND_COOLDOWN_MS -
        (Date.now() - signer.lastResendAt.getTime())) /
        60000
    );
    return NextResponse.json(
      { error: `Aguarde ${wait} min antes de reenviar` },
      { status: 429 }
    );
  }

  if (signer.envelope.clicksignId && signer.clicksignId) {
    try {
      await notifySigner(signer.envelope.clicksignId, signer.clicksignId);
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

  const updated = await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: {
      resendCount: { increment: 1 },
      lastResendAt: new Date(),
      ...(signer.status === "pending"
        ? { status: "notified", notifiedAt: new Date() }
        : {}),
    },
  });
  return NextResponse.json({ signer: updated });
}

export async function DELETE(
  req: NextRequest,
  {
    params,
  }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    ctx.orgId,
    params.id
  );
  if (!signer) {
    return NextResponse.json(
      { error: "Signatário não encontrado" },
      { status: 404 }
    );
  }
  if (signer.status === "signed") {
    return NextResponse.json(
      { error: "Signatário já assinou — não pode ser removido" },
      { status: 400 }
    );
  }
  const envStatus = signer.envelope.status;
  if (envStatus !== "draft" && envStatus !== "running") {
    return NextResponse.json(
      { error: "Envelope não permite remoção neste estado" },
      { status: 400 }
    );
  }

  if (signer.envelope.clicksignId && signer.clicksignId) {
    try {
      await removeSigner(signer.envelope.clicksignId, signer.clicksignId);
    } catch (err) {
      if (err instanceof ClicksignError && err.status !== 404) {
        return NextResponse.json(
          { error: `Clicksign: ${err.message}` },
          { status: 502 }
        );
      }
    }
  }

  await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: { status: "removed" },
  });
  return NextResponse.json({ ok: true });
}
