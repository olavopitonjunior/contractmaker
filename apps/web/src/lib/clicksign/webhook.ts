import crypto from "node:crypto";
import type { WebhookEventName, WebhookPayload } from "./types";

// Verifica HMAC-SHA256 do body cru contra o secret cadastrado no dashboard
// da Clicksign. Comparação em tempo constante.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  // Header pode vir no formato "sha256=..." ou só o hex.
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  if (provided.length !== computed.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(computed, "hex")
    );
  } catch {
    return false;
  }
}

const KNOWN_EVENTS: WebhookEventName[] = [
  "upload",
  "add_signer",
  "remove_signer",
  "sign",
  "signature_started",
  "refusal",
  "cancel",
  "close",
  "auto_close",
  "deadline",
  "document_closed",
  "update_deadline",
];

export function parseWebhookEventName(payload: WebhookPayload): WebhookEventName | null {
  const name = payload?.event?.name;
  if (!name) return null;
  return KNOWN_EVENTS.includes(name) ? name : null;
}

/**
 * Nome CRU do evento (mesmo os que não tratamos, ex.:
 * `tracking_notification_error` de bounce de e-mail). Usado só pra registrar
 * no `EnvelopeEvent` — antes eventos desconhecidos eram descartados sem log,
 * o que escondia sinais como falha de entrega. NÃO dispara mutação.
 */
export function getRawEventName(payload: WebhookPayload): string | null {
  const name = payload?.event?.name;
  return name ? String(name) : null;
}

/**
 * Aceite via WhatsApp (`acceptance_term_*`) — produto SEPARADO do envelope, sem
 * `document.key` nem `envelope.id`. O webhook referencia um `acceptance_term`
 * por id. Retorna `{ acceptanceId, phase }` quando o evento é de Aceite, senão
 * null (o caller segue o fluxo de envelope). A fase é o sufixo do nome cru:
 * `sent | completed | refused | expired | canceled | error | created`.
 */
export function getAcceptanceEventFromPayload(
  payload: WebhookPayload
): { acceptanceId: string; phase: string } | null {
  const raw = getRawEventName(payload);
  if (!raw || !raw.startsWith("acceptance_term")) return null;
  const phase = raw.replace(/^acceptance_term[_.]?/, "") || "unknown";
  // O id do termo pode vir em vários pontos conforme a versão do payload. O
  // payload REAL da ClickSign (v3) traz o termo em `acceptance.key` no topo —
  // sem essa entrada o id saía null e o Aceite caía no lookup de envelope
  // (unknownEnvelope) e sumia silenciosamente, sem avançar o status.
  const p = payload as unknown as {
    event?: { data?: { acceptance_term?: { id?: string }; id?: string } };
    acceptance?: { id?: string; key?: string };
    acceptance_term?: { id?: string; key?: string };
    data?: { id?: string };
  };
  const acceptanceId =
    p.acceptance?.key ||
    p.acceptance?.id ||
    p.event?.data?.acceptance_term?.id ||
    p.event?.data?.id ||
    p.acceptance_term?.id ||
    p.acceptance_term?.key ||
    p.data?.id ||
    null;
  if (!acceptanceId) return null;
  return { acceptanceId, phase };
}

export function getEnvelopeIdFromPayload(payload: WebhookPayload): string | null {
  // v3 publica eventos por envelope; o id pode vir em event.data.envelope_id
  // ou no objeto envelope dependendo da versão.
  const fromEvent =
    (payload.event?.data as { envelope_id?: string } | undefined)?.envelope_id ||
    (payload.event?.data as { envelope?: { id?: string } } | undefined)?.envelope?.id;
  if (fromEvent) return fromEvent;
  if (payload.envelope?.id) return payload.envelope.id;
  return null;
}

/**
 * Em ClickSign v3 atual o webhook NÃO inclui o envelope.id no payload —
 * apenas `document.key` (UUID do documento). Esse helper extrai a key
 * do documento; o caller deve fazer lookup em
 * `Envelope.documentClicksignId` pra encontrar o envelope local.
 */
export function getDocumentKeyFromPayload(
  payload: WebhookPayload
): string | null {
  return payload.document?.key ?? null;
}

/**
 * `key` do signatário na ClickSign — identificador estável e único, ao
 * contrário do e-mail. É o que persistimos em `EnvelopeSigner.clicksignId`.
 *
 * Preferir SEMPRE esta âncora ao e-mail: dois signatários do mesmo envelope
 * podem compartilhar o e-mail (cônjuges, procurador que usa o e-mail do
 * outorgante), e nesse caso o e-mail não identifica ninguém.
 */
export function getSignerKeyFromPayload(payload: WebhookPayload): string | null {
  const data = payload.event?.data as
    | { signer?: { key?: string } }
    | undefined;
  if (data?.signer?.key) return data.signer.key;
  if (payload.signers && payload.signers.length === 1) {
    return payload.signers[0]?.key ?? null;
  }
  return null;
}

export function getSignerEmailFromPayload(payload: WebhookPayload): string | null {
  const data = payload.event?.data as
    | { signer?: { email?: string } }
    | undefined;
  if (data?.signer?.email) return data.signer.email;
  if (payload.signers && payload.signers.length === 1) {
    return payload.signers[0]?.email ?? null;
  }
  return null;
}

export function getSignedDocumentUrlFromPayload(
  payload: WebhookPayload
): string | null {
  return payload.document?.downloads?.signed_file_url ?? null;
}
