import { describe, it, expect } from "vitest";
import {
  issueWebhookToken,
  verifyWebhookToken,
  verifyTokenCredentials,
  verifyWebhookRequest,
  WEBHOOK_TOKEN_TTL_S,
} from "../webhook-auth";

const SLUG = "abc123slug";
const SECRET = "s3cr3t-da-conta";
const NOW = Date.parse("2026-09-05T00:00:00Z");

function req(url: string, headers: Record<string, string> = {}) {
  return { url, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
}

describe("token do webhook (emitido por /token, escopado ao slug)", () => {
  it("emite e verifica com o mesmo segredo; expira em WEBHOOK_TOKEN_TTL_S", () => {
    const { token, expiresIn } = issueWebhookToken(SLUG, SECRET, NOW);
    expect(expiresIn).toBe(WEBHOOK_TOKEN_TTL_S);
    expect(verifyWebhookToken(token, SLUG, SECRET, NOW + 1000)).toBe(true);
    expect(verifyWebhookToken(token, SLUG, SECRET, NOW + (WEBHOOK_TOKEN_TTL_S + 1) * 1000)).toBe(false);
  });

  it("recusa outro slug, outro segredo, assinatura adulterada e forma inválida", () => {
    const { token } = issueWebhookToken(SLUG, SECRET, NOW);
    expect(verifyWebhookToken(token, "outro", SECRET, NOW)).toBe(false);
    expect(verifyWebhookToken(token, SLUG, "outro-segredo", NOW)).toBe(false);
    expect(verifyWebhookToken(token.slice(0, -2) + "zz", SLUG, SECRET, NOW)).toBe(false);
    expect(verifyWebhookToken("lixo", SLUG, SECRET, NOW)).toBe(false);
    expect(verifyWebhookToken("", SLUG, SECRET, NOW)).toBe(false);
  });
});

describe("credenciais do /token", () => {
  const account = { tokenUser: "fc_abc", tokenPassword: "p@ss" };
  it("par certo passa; qualquer parte errada ou não-string falha", () => {
    expect(verifyTokenCredentials({ username: "fc_abc", password: "p@ss" }, account)).toBe(true);
    expect(verifyTokenCredentials({ username: "fc_abc", password: "nope" }, account)).toBe(false);
    expect(verifyTokenCredentials({ username: "x", password: "p@ss" }, account)).toBe(false);
    expect(verifyTokenCredentials({ username: undefined, password: "p@ss" }, account)).toBe(false);
    expect(verifyTokenCredentials({ username: 1, password: "p@ss" }, account)).toBe(false);
  });
});

describe("verifyWebhookRequest — Bearer OU ?k=, nada mais", () => {
  it("Bearer válido → 'bearer'", () => {
    const { token } = issueWebhookToken(SLUG, SECRET, NOW);
    expect(verifyWebhookRequest(req("https://x/api/webhooks/fichacerta/abc", { authorization: `Bearer ${token}` }), SLUG, SECRET, NOW)).toBe("bearer");
  });
  it("?k= igual ao segredo → 'query'; diferente → null; sem nada → null", () => {
    expect(verifyWebhookRequest(req(`https://x/w?k=${encodeURIComponent(SECRET)}`), SLUG, SECRET, NOW)).toBe("query");
    expect(verifyWebhookRequest(req("https://x/w?k=errado"), SLUG, SECRET, NOW)).toBeNull();
    expect(verifyWebhookRequest(req("https://x/w"), SLUG, SECRET, NOW)).toBeNull();
  });
  it("Bearer expirado com ?k= errado → null (uma via ruim não é compensada pela outra)", () => {
    const { token } = issueWebhookToken(SLUG, SECRET, NOW - 10 * 3600 * 1000);
    expect(verifyWebhookRequest(req("https://x/w?k=errado", { authorization: `Bearer ${token}` }), SLUG, SECRET, NOW)).toBeNull();
  });
});
