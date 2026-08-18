// Processamento compartilhado do webhook ClickSign — usado pela rota legada
// (/api/webhooks/clicksign, secret global da org compartilhada) E pela rota
// per-org (/api/webhooks/clicksign/[slug], secret da conta do tenant). A
// verificação de HMAC fica em cada rota (o secret difere); aqui é só a lógica
// de resolver o envelope + aplicar mutações, idêntica nos dois caminhos.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  persistSignedPdf,
  persistSignedDocumentByKey,
} from "@/lib/clicksign/signed-pdf";
import { audit } from "@/lib/security/audit";
import {
  getAcceptanceEventFromPayload,
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
import { notifyEnvelopeMilestone, resolveDealLink } from "@/lib/clicksign/notify-envelope";
import { notifyDealEvent } from "@/lib/notifications/deal-events";
import {
  completeInspectionOnEnvelopeClosed,
  revertInspectionOnEnvelopeCanceled,
} from "@/lib/locacao/inspection-signature";
import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
  onProposalEnvelopeCanceled,
} from "@/lib/proposals/webhook-hooks";
import { processProposalAcceptanceEvent } from "@/lib/proposals/acceptance-webhook";

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
  envelope: {
    id: string;
    orgId: string;
    clicksignId: string | null;
    documentClicksignId: string | null;
  },
  payload: WebhookPayload
): void {
  const fromPayload = getSignedDocumentUrlFromPayload(payload);
  // A URL do payload (compat v2) é do documento DO EVENTO. Num envelope com
  // vários documentos ela pode ser a de um documento EXTRA — gravá-la como
  // `signedDocumentUrl` trocaria o contrato assinado pelo anexo. Só confiamos
  // nela quando o evento é do documento primary (ou quando não dá pra saber, em
  // envelope antigo sem `documentClicksignId`).
  const eventDocKey = getDocumentKeyFromPayload(payload);
  const isPrimaryEvent =
    !eventDocKey ||
    !envelope.documentClicksignId ||
    eventDocKey === envelope.documentClicksignId;
  if (fromPayload && isPrimaryEvent) {
    waitUntil(downloadSignedPdf(envelope.id, fromPayload));
  } else if (envelope.clicksignId) {
    waitUntil(
      resolveAndDownload(
        envelope.id,
        envelope.orgId,
        envelope.clicksignId,
        envelope.documentClicksignId
      )
    );
  }
}

/**
 * O QUE um evento de fechamento pode fechar.
 *
 * Na v3 o fechamento é POR DOCUMENTO: `document_closed` chega uma vez por
 * documento do envelope. Num envelope unificado (contrato + laudo de vistoria)
 * o laudo costuma fechar PRIMEIRO — tratá-lo como fechamento do envelope
 * promovia o deal, concluía a Inspection e avisava as partes que "o contrato foi
 * assinado" antes de o contrato existir assinado.
 *
 *  - `attachment`      → evento de um documento EXTRA. Só persiste o assinado DELE.
 *  - `primary_partial` → evento do documento PRINCIPAL num envelope que TEM
 *                        extras. Baixa o assinado do principal, mas NÃO fecha:
 *                        o `close`/`auto_close` do envelope cascateia quando
 *                        todos os documentos fecharem.
 *  - `full`            → comportamento antigo (fecha o envelope). Cobre
 *                        `close`/`auto_close` sempre e o `document_closed` de
 *                        envelope de documento único — inclusive todo envelope
 *                        anterior à tabela `EnvelopeDocument`.
 */
type CloseScope =
  | { kind: "attachment"; documentClicksignId: string }
  | { kind: "primary_partial" }
  | { kind: "full" };

async function resolveCloseScope(
  envelopeId: string,
  eventName: string | null,
  documentKey: string | null
): Promise<CloseScope> {
  // `close`/`auto_close` são do ENVELOPE — seguem fechando sempre.
  if (eventName !== "document_closed") return { kind: "full" };

  const docs = await prisma.envelopeDocument.findMany({
    where: { envelopeId },
    select: { documentClicksignId: true, kind: true },
  });
  // Envelope sem rows (documento único / legado) → caminho antigo intacto.
  if (docs.length === 0) return { kind: "full" };

  const eventDoc = documentKey
    ? docs.find((d) => d.documentClicksignId === documentKey)
    : undefined;
  if (eventDoc?.kind === "attachment") {
    return { kind: "attachment", documentClicksignId: eventDoc.documentClicksignId };
  }
  // Deliberadamente conservador: num envelope COM extras, qualquer
  // `document_closed` que não seja identificável como extra (o primary, ou uma
  // key que não casa com nenhuma row) não fecha o envelope.
  if (docs.some((d) => d.kind === "attachment")) return { kind: "primary_partial" };
  return { kind: "full" };
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

  // Aceite via WhatsApp (`acceptance_term_*`) — sem envelope; resolvido pelo
  // acceptance_term id. Intercepta ANTES do lookup de envelope (senão cairia no
  // `unknownEnvelope` e sumiria).
  const acceptance = getAcceptanceEventFromPayload(payload);
  if (acceptance) {
    const r = await processProposalAcceptanceEvent({
      acceptanceId: acceptance.acceptanceId,
      phase: acceptance.phase,
      payload,
      orgId: opts?.orgId,
    });
    return {
      ok: true,
      eventName: rawEventName ?? undefined,
      unknownEnvelope: r.unknownAcceptance,
    };
  }

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
      ? // O `document.key` pode ser o do documento PRIMARY (coluna escalar, e
        // único caminho pros envelopes anteriores ao EnvelopeDocument) ou o de
        // um documento EXTRA do mesmo envelope. Sem o segundo OR, um evento do
        // laudo num envelope unificado caía em `unknownEnvelope`.
        await prisma.envelope.findFirst({
          where: {
            ...orgScope,
            OR: [
              { documentClicksignId: documentKey },
              { documents: { some: { documentClicksignId: documentKey } } },
            ],
          },
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
      if (eventName && closeEvents.includes(eventName)) {
        const scope = await resolveCloseScope(envelope.id, eventName, documentKey);
        if (scope.kind === "attachment") {
          // Reentrega do `document_closed` de um documento EXTRA: recupera só o
          // assinado DELE (idempotente por `signedPdfUrl` já preenchido) e
          // NUNCA a URL do primary — senão o laudo reentregue gravaria o
          // contrato como assinado antes da hora.
          waitUntil(
            persistSignedDocumentByKey(
              envelope.id,
              scope.documentClicksignId,
              "[clicksign webhook]"
            )
          );
        } else if (!envelope.signedDocumentUrl) {
          triggerSignedPdfDownload(envelope, payload);
        }
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
      // Proposta: recusa move o status (proponente vs proprietário). No-op p/
      // envelope de contrato/attachment. O sourceKind do signatário resolvido
      // desambigua a via ÚNICA (proponente e proprietário no mesmo envelope).
      await onProposalEnvelopeRefused(envelope.id, {
        refusedSourceKind: signer?.sourceKind ?? null,
      });
      await notifyEnvelopeMilestone({
        envelopeId: envelope.id,
        orgId: envelope.orgId,
        source: envelope.source,
        dealId: envelope.dealId,
        linkUrl: await resolveDealLink(envelope.dealId),
        kind: "refused",
      });
      break;
    }
    case "close":
    case "auto_close":
    case "document_closed": {
      const scope = await resolveCloseScope(envelope.id, eventName, documentKey);
      if (scope.kind === "attachment") {
        // (a) Documento EXTRA fechou: guarda o assinado dele e NADA mais. O
        // envelope segue running — o contrato ainda não foi assinado.
        waitUntil(
          persistSignedDocumentByKey(
            envelope.id,
            scope.documentClicksignId,
            "[clicksign webhook]"
          )
        );
        break;
      }
      if (scope.kind === "primary_partial") {
        // (c) Documento PRINCIPAL fechou, mas o envelope tem extras: baixa o
        // contrato assinado sem fechar o envelope. O `close`/`auto_close`
        // cascateia quando todos os documentos fecharem.
        triggerSignedPdfDownload(envelope, payload);
        break;
      }
      // (b) `close`/`auto_close`, ou `document_closed` de envelope de documento
      // único: comportamento antigo, intacto.
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "closed", closedAt: new Date() },
      });
      await autoPromoteDealOnContractSigned(envelope.id);
      await completeInspectionOnEnvelopeClosed(envelope.id);
      // Proposta: avança o status (assinada_proponente / completa / aguardando
      // vendedor). No-op p/ envelope de contrato/attachment.
      await onProposalEnvelopeClosed(envelope.id);
      await notifyEnvelopeMilestone({
        envelopeId: envelope.id,
        orgId: envelope.orgId,
        source: envelope.source,
        dealId: envelope.dealId,
        linkUrl: await resolveDealLink(envelope.dealId),
        kind: "signed",
      });
      // Fan-out pros corretores (email/WhatsApp). O SINO deste evento pertence
      // ao notifyEnvelopeMilestone acima — o motor não re-emite (OWNS_BELL).
      // dedupeKey=envelope.id: webhook reentregue não re-envia.
      if (envelope.source === "contract" && envelope.dealId) {
        waitUntil(
          notifyDealEvent({
            dealId: envelope.dealId,
            orgId: envelope.orgId,
            event: "contract_signed",
            dedupeKey: envelope.id,
            context: { extra: { envelopeId: envelope.id } },
          })
        );
      }
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
      // Proposta: 2ª via cancelada/expirada devolve à parada de decisão (bug D
      // — antes ficava presa em aguardando_vendedor pra sempre). No-op p/
      // envelope de contrato/attachment e pra via completa.
      await onProposalEnvelopeCanceled(envelope.id);
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

/**
 * Lookup signed_file_url via /documents quando o webhook v3 não traz a URL.
 *
 * `primaryDocumentId` é o documento SUJEITO do envelope: num envelope com vários
 * documentos (contrato + laudo de vistoria) o primeiro da lista remota pode ser
 * o extra, e `persistSignedPdf` grava o que recebe como o assinado principal.
 * Os extras são baixados depois, dentro de `persistSignedPdf`.
 */
async function resolveAndDownload(
  envelopeId: string,
  orgId: string,
  clicksignId: string,
  primaryDocumentId?: string | null
) {
  try {
    const creds = await resolveClickSignCreds(orgId);
    if (!creds) return;
    const docs = await listEnvelopeDocuments(clicksignId, creds);
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return;
    const list = docsData as Array<{
      id?: string;
      links?: { files?: { signed?: string; original?: string } };
    }>;
    const ordered = primaryDocumentId
      ? [
          ...list.filter((d) => d.id === primaryDocumentId),
          ...list.filter((d) => d.id !== primaryDocumentId),
        ]
      : list;
    for (const doc of ordered) {
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
