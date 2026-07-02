import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { persistSignedPdf } from "@/lib/clicksign/signed-pdf";
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
import { autoPromoteDealOnContractSigned } from "@/lib/contracts/auto-promote-signed";
import {
  completeInspectionOnEnvelopeClosed,
  revertInspectionOnEnvelopeCanceled,
} from "@/lib/locacao/inspection-signature";

export const runtime = "nodejs";

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
  // Pré-resolução de tenant: ainda não sabemos qual envelope/org é. orgId=null
  // (Fase 0c) em vez de cair na org compartilhada legada. Pós-resolução audita
  // com o orgId real.
  await audit(
    { orgId: null, userId: null },
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

  // Fail-closed: sem secret configurado, NÃO processa (antes o bloco HMAC era
  // pulado e qualquer POST forjava um `close` → auto-promoção de deal + SSRF
  // no downloadSignedPdf). Espelha o webhook Asaas, que já rejeita sem token.
  if (!secret) {
    console.error(
      "[clicksign webhook] CLICKSIGN_WEBHOOK_SECRET não configurado — rejeitando request"
    );
    await audit(
      { orgId: null, userId: null },
      {
        action: "CLICKSIGN_WEBHOOK_REJECTED",
        result: "DENIED",
        resourceType: "Webhook",
        metadata: { reason: "secret not configured", bodyHash },
      }
    ).catch(() => {});
    return NextResponse.json(
      { error: "Webhook não configurado" },
      { status: 503 }
    );
  }

  {
    const sigHeader =
      req.headers.get("content-hmac") ||
      req.headers.get("x-clicksign-signature") ||
      req.headers.get("x-hub-signature-256");
    const ok = verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!ok) {
      await audit(
        { orgId: null, userId: null },
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

  // Pós-resolução: agora sabemos o tenant. Audita com o orgId real do envelope
  // (Fase 0c) — antes tudo caía na org compartilhada legada.
  await audit(
    { orgId: envelope.orgId, userId: null },
    {
      action: "CLICKSIGN_WEBHOOK_PROCESSED",
      result: "SUCCESS",
      resourceType: "Envelope",
      resource: envelope.id,
      metadata: { eventName, envelopeId: envelope.id, clicksignEnvelopeId, documentKey },
    }
  ).catch(() => {});

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

      // Auto-promove deal pra "Contrato assinado" — apenas envelopes
      // vinculados a Contract (source="contract"). Helper compartilhado
      // garante mesma lógica em webhook + sync route + cron.
      await autoPromoteDealOnContractSigned(envelope.id);
      // Laudo de vistoria assinado → Inspection vira "concluida".
      await completeInspectionOnEnvelopeClosed(envelope.id);

      // v3 NÃO traz signed_file_url no payload — tentamos extrair do
      // payload (compat v2) e, se vier null, fazemos lookup via
      // /api/v3/envelopes/{id}/documents (canônico v3).
      const fromPayload = getSignedDocumentUrlFromPayload(payload);
      if (fromPayload) {
        waitUntil(downloadSignedPdf(envelope.id, fromPayload));
      } else if (envelope.clicksignId) {
        waitUntil(resolveAndDownload(envelope.id, envelope.clicksignId));
      }
      break;
    }
    case "cancel": {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      await revertInspectionOnEnvelopeCanceled(envelope.id);
      break;
    }
    case "deadline": {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      await revertInspectionOnEnvelopeCanceled(envelope.id);
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
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return;
    // ClickSign v3: cada doc tem `links.files: { original, signed, ziped }`
    // com URLs pré-assinadas direto pro PDF binário.
    for (const doc of docsData as Array<{
      links?: { files?: { signed?: string; original?: string } };
    }>) {
      const url = doc.links?.files?.signed ?? doc.links?.files?.original;
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
  await persistSignedPdf(envelopeId, url, "[clicksign webhook]");
}
