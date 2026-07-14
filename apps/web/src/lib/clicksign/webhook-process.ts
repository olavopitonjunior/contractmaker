// Processamento compartilhado do webhook ClickSign — usado pela rota legada
// (/api/webhooks/clicksign, secret global da org compartilhada) E pela rota
// per-org (/api/webhooks/clicksign/[slug], secret da conta do tenant). A
// verificação de HMAC fica em cada rota (o secret difere); aqui é só a lógica
// de resolver o envelope + aplicar mutações, idêntica nos dois caminhos.

import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { persistSignedPdf } from "@/lib/clicksign/signed-pdf";
import { audit } from "@/lib/security/audit";
import {
  getDocumentKeyFromPayload,
  getEnvelopeIdFromPayload,
  getRawEventName,
  getSignedDocumentUrlFromPayload,
  getSignerEmailFromPayload,
  parseWebhookEventName,
} from "@/lib/clicksign/webhook";
import { listEnvelopeDocuments } from "@/lib/clicksign/envelopes";
import { resolveClickSignCreds } from "@/lib/clicksign/account";
import type { WebhookPayload } from "@/lib/clicksign/types";
import { autoPromoteDealOnContractSigned } from "@/lib/contracts/auto-promote-signed";
import {
  completeInspectionOnEnvelopeClosed,
  revertInspectionOnEnvelopeCanceled,
} from "@/lib/locacao/inspection-signature";

export interface ProcessResult {
  ok: true;
  ignored?: boolean;
  unknownEnvelope?: boolean;
  envelopeId?: string;
  eventName?: string;
}

/**
 * Processa um payload de webhook JÁ AUTENTICADO (HMAC verificado pela rota).
 *
 * @param opts.orgId Quando informado (rota per-org), o lookup do envelope é
 *   restrito a essa org — defesa cross-org: um webhook do tenant A nunca mexe
 *   num envelope do tenant B mesmo que o document.key colidisse.
 */
export async function processClickSignWebhookPayload(
  payload: WebhookPayload,
  opts?: { orgId?: string }
): Promise<ProcessResult> {
  const eventName = parseWebhookEventName(payload);
  const rawEventName = getRawEventName(payload);
  const clicksignEnvelopeId = getEnvelopeIdFromPayload(payload);
  const documentKey = getDocumentKeyFromPayload(payload);
  // Basta um nome (mesmo desconhecido) + uma âncora do envelope. Evento
  // desconhecido NÃO é mais descartado: resolvemos o envelope e registramos no
  // EnvelopeEvent — só não dispara mutação. Antes, um evento como
  // `tracking_notification_error` (bounce de e-mail) sumia sem deixar rastro, e
  // o operador não tinha como saber que o e-mail do signatário voltou.
  if (!rawEventName || (!clicksignEnvelopeId && !documentKey)) {
    return { ok: true, ignored: true };
  }

  // ClickSign v3 webhook NÃO traz envelope.id no payload — apenas document.key.
  // Tentamos por envelope.id (legacy v2), depois por documentClicksignId.
  const orgScope = opts?.orgId ? { orgId: opts.orgId } : {};
  const envelope = clicksignEnvelopeId
    ? await prisma.envelope.findFirst({
        where: { clicksignId: clicksignEnvelopeId, ...orgScope },
      })
    : documentKey
      ? await prisma.envelope.findFirst({
          where: { documentClicksignId: documentKey, ...orgScope },
        })
      : null;
  if (!envelope) {
    return { ok: true, unknownEnvelope: true };
  }

  await audit(
    { orgId: envelope.orgId, userId: null },
    {
      action: "CLICKSIGN_WEBHOOK_PROCESSED",
      result: "SUCCESS",
      resourceType: "Envelope",
      resource: envelope.id,
      metadata: {
        eventName: rawEventName,
        handled: Boolean(eventName),
        envelopeId: envelope.id,
        clicksignEnvelopeId,
        documentKey,
      },
    }
  ).catch(() => {});

  // Registra SEMPRE — inclusive o que não tratamos (`eventName` null). O nome
  // cru fica no EnvelopeEvent pra diagnóstico.
  await prisma.envelopeEvent.create({
    data: {
      envelopeId: envelope.id,
      eventName: rawEventName,
      payload: payload as unknown as Prisma.InputJsonValue,
      source: "webhook",
    },
  });

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
      await autoPromoteDealOnContractSigned(envelope.id);
      await completeInspectionOnEnvelopeClosed(envelope.id);

      // v3 não traz signed_file_url no payload — tenta do payload (compat v2) e,
      // se null, faz lookup via /documents (canônico v3, requer creds da org).
      const fromPayload = getSignedDocumentUrlFromPayload(payload);
      if (fromPayload) {
        waitUntil(downloadSignedPdf(envelope.id, fromPayload));
      } else if (envelope.clicksignId) {
        waitUntil(resolveAndDownload(envelope.id, envelope.orgId, envelope.clicksignId));
      }
      break;
    }
    case "cancel":
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
      // Log no EnvelopeEvent já feito acima.
      break;
  }

  // Devolve o nome CRU: um evento não tratado (ex.: bounce) foi registrado, e o
  // caller precisa enxergá-lo — não um `undefined` que parece "nada aconteceu".
  return { ok: true, envelopeId: envelope.id, eventName: rawEventName ?? undefined };
}

/** Lookup signed_file_url via /documents quando o webhook v3 não traz a URL. */
async function resolveAndDownload(
  envelopeId: string,
  orgId: string,
  clicksignId: string
) {
  try {
    const creds = await resolveClickSignCreds(orgId);
    if (!creds) return;
    const docs = await listEnvelopeDocuments(clicksignId, creds);
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return;
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
