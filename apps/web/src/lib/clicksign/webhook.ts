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
