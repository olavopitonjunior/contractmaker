import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { audit } from "@/lib/security/audit";
import {
  getDocumentKeyFromPayload,
  getEnvelopeIdFromPayload,
  getSignedDocumentUrlFromPayload,
  getSignerEmailFromPayload,
  parseWebhookEventName,
  verifyWebhookSignature,
} from "@/lib/clicksign/webhook";
import { listEnvelopeDocuments } from "@/lib/clicksign/envelopes";
import type { WebhookPayload } from "@/lib/clicksign/types";

export const runtime = "nodejs";

const SHARED_ORG_ID = process.env.SHARED_ORG_ID || "cmnt1ldo4000111bw4yo517k0";

/**
 * Coleta os headers que importam pra debugar HMAC + identificação. Não
 * loga `cookie`, `authorization`, etc. — apenas headers ClickSign-specific
 * + content-type/length.
 */
function collectRelevantHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const want = [
    "content-type",
    "content-length",
    "user-agent",
    "content-hmac",
    "x-clicksign-signature",
    "x-hub-signature-256",
    "x-clicksign-event",
    "x-forwarded-for",
  ];
  for (const h of want) {
    const v = req.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const headers = collectRelevantHeaders(req);
  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex")
    .slice(0, 16);

  // Log SEMPRE — incluindo quando HMAC falha. Isso permite diagnosticar
  // se o ClickSign está realmente mandando, com qual header de
  // assinatura, e se nosso secret bate.
  await audit(
    { orgId: SHARED_ORG_ID, userId: null },
    {
      action: "CLICKSIGN_WEBHOOK_RECEIVED",
      result: "SUCCESS",
      resourceType: "Webhook",
      metadata: {
        headers,
        bodyHash,
        bodyLength: rawBody.length,
        bodyExcerpt: rawBody.slice(0, 1000),
      },
    }
  ).catch(() => {});

  if (secret) {
    const sigHeader =
      req.headers.get("content-hmac") ||
      req.headers.get("x-clicksign-signature") ||
      req.headers.get("x-hub-signature-256");
    const ok = verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!ok) {
      await audit(
        { orgId: SHARED_ORG_ID, userId: null },
        {
          action: "CLICKSIGN_WEBHOOK_REJECTED",
          result: "DENIED",
          resourceType: "Webhook",
          metadata: {
            reason: "HMAC mismatch",
            sigHeaderPresent: Boolean(sigHeader),
            sigHeaderName: req.headers.get("content-hmac")
              ? "content-hmac"
              : req.headers.get("x-clicksign-signature")
                ? "x-clicksign-signature"
                : req.headers.get("x-hub-signature-256")
                  ? "x-hub-signature-256"
                  : null,
            sigPreview: sigHeader?.slice(0, 16),
            bodyHash,
          },
        }
      ).catch(() => {});
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
  const documentKey = getDocumentKeyFromPayload(payload);
  if (!eventName || (!clicksignEnvelopeId && !documentKey)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // ClickSign v3 webhook NÃO traz envelope.id no payload — apenas
  // document.key. Tentamos por envelope.id se disponível (legacy v2),
  // depois caímos pro lookup por documentClicksignId.
  const envelope = clicksignEnvelopeId
    ? await prisma.envelope.findUnique({
        where: { clicksignId: clicksignEnvelopeId },
      })
    : documentKey
      ? await prisma.envelope.findFirst({
          where: { documentClicksignId: documentKey },
        })
      : null;
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
      // v3 NÃO traz signed_file_url no payload — tentamos extrair do
      // payload (compat v2) e, se vier null, fazemos lookup via
      // /api/v3/envelopes/{id}/documents (canônico v3).
      const fromPayload = getSignedDocumentUrlFromPayload(payload);
      if (fromPayload) {
        void downloadSignedPdf(envelope.id, fromPayload);
      } else if (envelope.clicksignId) {
        void resolveAndDownload(envelope.id, envelope.clicksignId);
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

/**
 * Lookup signed_file_url via ClickSign /documents endpoint quando o
 * webhook payload v3 não traz a URL inline (caso típico).
 */
async function resolveAndDownload(envelopeId: string, clicksignId: string) {
  try {
    const docs = await listEnvelopeDocuments(clicksignId);
    const data = (docs as { data?: unknown }).data;
    if (!Array.isArray(data)) return;
    for (const doc of data as Array<{
      attributes?: { downloads?: { signed_file_url?: string } };
    }>) {
      const url = doc.attributes?.downloads?.signed_file_url;
      if (url) {
        await downloadSignedPdf(envelopeId, url);
        return;
      }
    }
  } catch (err) {
    console.error("[clicksign webhook] falha resolveAndDownload:", err);
  }
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

    // Espelha o PDF assinado na pasta Documentos do deal pra que o usuário
    // veja e baixe o arquivo final pelo mesmo lugar onde acompanha os outros
    // anexos da venda. Idempotente: ClickSign pode reentregar `close` —
    // checamos por url antes de criar.
    const env = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: {
        dealId: true,
        source: true,
        name: true,
        contract: { select: { version: true } },
      },
    });
    if (env?.dealId) {
      const existing = await prisma.dealAttachment.findFirst({
        where: { dealId: env.dealId, url: stored },
        select: { id: true },
      });
      if (!existing) {
        const category =
          env.source === "attachment" ? "documento_assinado" : "contrato_assinado";
        const filename = env.contract
          ? `Contrato assinado v${env.contract.version}.pdf`
          : `${env.name} (assinado).pdf`;
        await prisma.dealAttachment.create({
          data: {
            dealId: env.dealId,
            filename,
            mime: "application/pdf",
            url: stored,
            category,
            source: "clicksign_signed",
          },
        });
      }
    }
  } catch (err) {
    console.error("[clicksign webhook] falha ao baixar PDF assinado:", err);
  }
}
