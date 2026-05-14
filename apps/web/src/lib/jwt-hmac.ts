import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Helper genérico JWT-HMAC HS256 — stateless tokens com TTL.
 *
 * Compartilhado por:
 *   - `lib/forms/participant-token.ts` (PR 4 — subtoken vendedor/comprador)
 *
 * TODO (cleanup futuro): refatorar `lib/financeiro/completion-token.ts` +
 * `api/financeiro/split-recipients/[id]/request-completion/route.ts` (signToken
 * duplicado inline) pra também consumir este helper. Mantive intocado pra
 * minimizar blast radius — magic link já está em prod.
 */

function b64urlEncode(s: string): string {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(norm, "base64").toString("utf8");
}

export function signToken(payload: object, secret: string): string {
  const head = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${head}.${body}.${sig}`;
}

export type VerifyTokenResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

/**
 * Verifica assinatura HMAC-SHA256 + checa exp (epoch seconds). NÃO consulta
 * DB — caller deve validar idempotência (ex: confirmar match com row salva)
 * quando necessário.
 *
 * Type parameter T deve incluir `exp: number` — caller faz typecast.
 */
export function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string,
): VerifyTokenResult<T> {
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

  let payload: T;
  try {
    payload = JSON.parse(b64urlDecode(body)) as T;
  } catch {
    return { ok: false, error: "Payload inválido" };
  }

  if (typeof payload.exp !== "number") {
    return { ok: false, error: "Payload sem exp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, error: "Token expirado" };

  return { ok: true, payload };
}
