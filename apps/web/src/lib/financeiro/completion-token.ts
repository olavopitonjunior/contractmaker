import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * JWT-ish HMAC-SHA256 token usado pra completar cadastro de SplitRecipient
 * sem login. Stateless — verificação é localizada (assinatura + exp + match
 * persistido em SplitRecipient.completionToken pra invalidar após uso).
 */

interface CompletionPayload {
  recipientId: string;
  orgId: string;
  exp: number; // epoch seconds
}

function b64urlDecode(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(norm, "base64").toString("utf8");
}

export interface VerifyResult {
  ok: boolean;
  payload?: CompletionPayload;
  error?: string;
}

export function verifyCompletionToken(
  token: string,
  secret: string
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "Token mal-formado" };
  const [head, body, sig] = parts;

  const expected = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Assinatura inválida" };
  }

  let payload: CompletionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as CompletionPayload;
  } catch {
    return { ok: false, error: "Payload inválido" };
  }

  if (!payload.recipientId || !payload.orgId || !payload.exp) {
    return { ok: false, error: "Payload incompleto" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, error: "Token expirado" };

  return { ok: true, payload };
}
