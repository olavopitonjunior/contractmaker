import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import {
  getEnvelopeIdFromPayload,
  getSignedDocumentUrlFromPayload,
  getSignerEmailFromPayload,
  parseWebhookEventName,
  verifyWebhookSignature,
} from "@/lib/clicksign/webhook";
import type { WebhookPayload } from "@/lib/clicksign/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET;
  const rawBody = await req.text();

  if (secret) {
    const sigHeader =
      req.headers.get("content-hmac") ||
      req.headers.get("x-clicksign-signature") ||
      req.headers.get("x-hub-signature-256");
    const ok = verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!ok) {
      return NextResponse.json(
        { error: "Assinatura inválida" },
        { status: 401 }
      );
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const eventName = parseWebhookEventName(payload);
  const clicksignEnvelopeId = getEnvelopeIdFromPayload(payload);
  if (!eventName || !clicksignEnvelopeId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const envelope = await prisma.envelope.findUnique({
    where: { clicksignId: clicksignEnvelopeId },
  });
  if (!envelope) {
    // Pode ser um envelope criado fora do nosso sistema; só logamos.
    return NextResponse.json({ ok: true, unknown_envelope: true });
  }

  await prisma.envelopeEvent.create({
    data: {
      envelopeId: envelope.id,
      eventName,
      payload: payload as unknown as Prisma.InputJsonValue,
      source: "webhook",
    },
  });

  // Aplica a mutação correspondente. Mantém handler curto: download do PDF
  // assinado roda fire-and-forget.
  switch (eventName) {
    case "sign":
    case "signature_started": {
      const email = getSignerEmailFromPayload(payload);
      if (email) {
        const signer = await prisma.envelopeSigner.findFirst({
          where: { envelopeId: envelope.id, email },
        });
        if (signer) {
          if (eventName === "sign") {
            await prisma.envelopeSigner.update({
              where: { id: signer.id },
              data: { status: "signed", signedAt: new Date() },
            });
          } else if (signer.status === "notified") {
            await prisma.envelopeSigner.update({
              where: { id: signer.id },
              data: { status: "viewed", viewedAt: new Date() },
            });
          }
        }
      }
      break;
    }
    case "refusal": {
      const email = getSignerEmailFromPayload(payload);
      if (email) {
        await prisma.envelopeSigner.updateMany({
          where: { envelopeId: envelope.id, email },
          data: { status: "refused", refusedAt: new Date() },
        });
      }
      break;
    }
    case "close":
    case "auto_close":
    case "document_closed": {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "closed", closedAt: new Date() },
      });
      const signedUrl = getSignedDocumentUrlFromPayload(payload);
      if (signedUrl) {
        void downloadSignedPdf(envelope.id, signedUrl);
      }
      break;
    }
    case "cancel": {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      break;
    }
    case "deadline": {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      break;
    }
    case "add_signer":
    case "remove_signer":
    case "update_deadline":
    case "upload":
      // Não precisa de mutação derivada — log no EnvelopeEvent já feito.
      break;
  }

  return NextResponse.json({ ok: true });
}

async function downloadSignedPdf(envelopeId: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const stored = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `envelopes/${envelopeId}/signed.pdf`,
      body: buf,
      contentType: "application/pdf",
    });
    await prisma.envelope.update({
      where: { id: envelopeId },
      data: { signedDocumentUrl: stored },
    });
  } catch (err) {
    console.error("[clicksign webhook] falha ao baixar PDF assinado:", err);
  }
}
