// Processamento compartilhado do webhook ClickSign — usado pela rota legada
// (/api/webhooks/clicksign, secret global da org compartilhada) E pela rota
// per-org (/api/webhooks/clicksign/[slug], secret da conta do tenant). A
// verificação de HMAC fica em cada rota (o secret difere); aqui é só a lógica
// de resolver o envelope + aplicar mutações, idêntica nos dois caminhos.

import { createHash } from "node:crypto";
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
  getSignerKeyFromPayload,
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
  duplicate?: boolean;
  envelopeId?: string;
  eventName?: string;
}

/**
 * Chave de idempotência estável do evento. ClickSign v3 não manda um id de
 * evento, então derivamos de campos estáveis do payload (envelope + nome do
 * evento + signatário + timestamp de ocorrência). Reentregas do MESMO evento
 * geram a mesma chave e são barradas pelo @unique do EnvelopeEvent.
 */
/**
 * Dispara o download do PDF assinado (fire-and-forget, idempotente por
 * findFirst). v3 não traz signed_file_url no payload — tenta do payload
 * (compat v2) e, se null, faz lookup via /documents (canônico v3). Usado tanto
 * no fechamento normal quanto na recuperação por reentrega.
 */
function triggerSignedPdfDownload(
  envelope: { id: string; orgId: string; clicksignId: string | null },
  payload: WebhookPayload
): void {
  const fromPayload = getSignedDocumentUrlFromPayload(payload);
  if (fromPayload) {
    waitUntil(downloadSignedPdf(envelope.id, fromPayload));
  } else if (envelope.clicksignId) {
    waitUntil(resolveAndDownload(envelope.id, envelope.orgId, envelope.clicksignId));
  }
}

export function computeEventDedupeKey(
  envelopeId: string,
  payload: WebhookPayload
): string {
  const parts = [
    envelopeId,
    getRawEventName(payload) ?? "",
    getSignerKeyFromPayload(payload) ?? getSignerEmailFromPayload(payload) ?? "",
    payload.event?.occurred_at ?? "",
    getDocumentKeyFromPayload(payload) ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
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
  // cru fica no EnvelopeEvent pra diagnóstico. O create com `dedupeKey @unique`
  // é o LOCK de idempotência: se a ClickSign reentregar o mesmo evento, o
  // segundo create dá P2002 e a gente NÃO re-dispara os efeitos que não devem
  // repetir (auto-promote de deal, mutação de status).
  const dedupeKey = computeEventDedupeKey(envelope.id, payload);
  const closeEvents = ["close", "auto_close", "document_closed"];
  try {
    await prisma.envelopeEvent.create({
      data: {
        envelopeId: envelope.id,
        eventName: rawEventName,
        payload: payload as unknown as Prisma.InputJsonValue,
        source: "webhook",
        dedupeKey,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Reentrega de um evento já visto. Os efeitos não-idempotentes já rodaram.
      // MAS a ClickSign reentrega justamente pra RECUPERAR uma 1ª entrega em que
      // o download do PDF assinado (fire-and-forget) falhou transientemente. Se
      // for um evento de fechamento e o PDF ainda estiver faltando, re-dispara
      // SÓ o download (idempotente por findFirst) — senão o contrato assinado
      // ficava permanentemente ausente da pasta apesar da reentrega.
      if (
        eventName &&
        closeEvents.includes(eventName) &&
        !envelope.signedDocumentUrl
      ) {
        triggerSignedPdfDownload(envelope, payload);
      }
      return {
        ok: true,
        duplicate: true,
        envelopeId: envelope.id,
        eventName: eventName ?? undefined,
      };
    }
    throw err;
  }

  switch (eventName) {
    case "sign":
    case "signature_started": {
      const signer = await resolveSigner(envelope.id, payload, {
        // Um 2º evento `sign` no mesmo envelope é de OUTRO signatário: quando o
        // fallback por e-mail é ambíguo, pular quem já assinou faz N eventos
        // marcarem N signatários em vez de reescreverem o mesmo.
        skipStatuses:
          eventName === "sign" ? ["signed"] : ["viewed", "signed", "refused"],
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
      break;
    }
    case "refusal": {
      // Antes: `updateMany` por e-mail — dois signatários que compartilham o
      // e-mail eram marcados como recusados quando só UM recusou. Agora resolve
      // um signatário só, pela `key` quando disponível.
      const signer = await resolveSigner(envelope.id, payload, {
        skipStatuses: ["refused"],
      });
      if (signer) {
        await prisma.envelopeSigner.update({
          where: { id: signer.id },
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
      triggerSignedPdfDownload(envelope, payload);
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

/**
 * Resolve QUAL `EnvelopeSigner` local o evento se refere.
 *
 * Ordem de confiança:
 *  1. `signer.key` da ClickSign → `EnvelopeSigner.clicksignId`. Âncora única e
 *     estável; é o caminho correto.
 *  2. Fallback por e-mail — necessário porque nem todo payload traz a key, e
 *     porque signers criados antes desta correção podem não ter `clicksignId`.
 *
 * O fallback é o ponto delicado: dois signatários do MESMO envelope podem ter o
 * mesmo e-mail (cônjuges, procurador que usa o e-mail do outorgante). O código
 * anterior fazia `findFirst` sem `orderBy` — o Postgres devolvia um deles ao
 * acaso, então um signatário era marcado e o outro ficava preso em `notified`
 * para sempre, e o envelope nunca fechava do nosso lado. Aqui a busca é
 * ordenada (determinística) e prefere quem ainda NÃO atingiu o estado alvo.
 */
export async function resolveSigner(
  envelopeId: string,
  payload: WebhookPayload,
  opts: { skipStatuses?: string[] } = {}
) {
  const key = getSignerKeyFromPayload(payload);
  if (key) {
    const byKey = await prisma.envelopeSigner.findFirst({
      where: { envelopeId, clicksignId: key },
    });
    if (byKey) return byKey;
  }

  const email = getSignerEmailFromPayload(payload);
  if (!email) return null;

  const candidates = await prisma.envelopeSigner.findMany({
    where: {
      envelopeId,
      email: { equals: email.trim(), mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
  });
  if (candidates.length === 0) return null;

  const skip = opts.skipStatuses ?? [];
  return candidates.find((s) => !skip.includes(s.status)) ?? candidates[0];
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
