/**
 * Autenticação do webhook de laudo da Ficha Certa — puro, sem Prisma.
 *
 * A Ficha Certa não assina o payload. O que ela oferece: antes de cada envio,
 * faz `POST token_url { username, password }` e manda o retorno como
 * `Authorization: Bearer …`. Nós emitimos um token HMAC curto, escopado ao
 * slug da conta, e aceitamos como alternativa o segredo de query (`?k=`)
 * gravado no `endpoint` do webhook — é o que vale quando o `token_url` não é
 * chamado (ou some numa reconfiguração deles). Segredos vêm da conta
 * (`FichaCertaAccount`), cifrados; nada de env de plataforma.
 */

import { createHmac } from "node:crypto";
import { timingSafeEqualStr } from "@/lib/security/crypto";

export const WEBHOOK_TOKEN_TTL_S = (() => {
  const n = Number(process.env.FICHACERTA_WEBHOOK_TOKEN_TTL_S ?? 3600);
  return Number.isFinite(n) && n > 0 ? n : 3600;
})();

function sign(slug: string, exp: number, querySecret: string): string {
  return createHmac("sha256", querySecret).update(`${slug}.${exp}`).digest("hex");
}

/** Token opaco `slug.exp.sig` — só verificável com o segredo da mesma conta. */
export function issueWebhookToken(
  slug: string,
  querySecret: string,
  now: number = Date.now()
): { token: string; expiresIn: number } {
  const exp = Math.floor(now / 1000) + WEBHOOK_TOKEN_TTL_S;
  return { token: `${slug}.${exp}.${sign(slug, exp, querySecret)}`, expiresIn: WEBHOOK_TOKEN_TTL_S };
}

export function verifyWebhookToken(
  token: string,
  slug: string,
  querySecret: string,
  now: number = Date.now()
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tSlug, expRaw, sig] = parts;
  if (tSlug !== slug) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  return timingSafeEqualStr(sig, sign(slug, exp, querySecret));
}

/** `POST …/token { username, password }` — compara com o par gravado na conta. */
export function verifyTokenCredentials(
  input: { username: unknown; password: unknown },
  account: { tokenUser: string; tokenPassword: string }
): boolean {
  if (typeof input.username !== "string" || typeof input.password !== "string") return false;
  const userOk = timingSafeEqualStr(input.username, account.tokenUser);
  const passOk = timingSafeEqualStr(input.password, account.tokenPassword);
  return userOk && passOk;
}

export type WebhookAuthVia = "bearer" | "query";

/**
 * Autentica a entrega do laudo: `Authorization: Bearer <token nosso>` OU
 * `?k=<segredo da conta>`. Devolve por qual via passou, ou null.
 */
export function verifyWebhookRequest(
  req: { headers: { get(name: string): string | null }; url: string },
  slug: string,
  querySecret: string,
  now: number = Date.now()
): WebhookAuthVia | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && verifyWebhookToken(m[1].trim(), slug, querySecret, now)) return "bearer";
  let k: string | null = null;
  try {
    k = new URL(req.url).searchParams.get("k");
  } catch {
    k = null;
  }
  if (k && timingSafeEqualStr(k, querySecret)) return "query";
  return null;
}
