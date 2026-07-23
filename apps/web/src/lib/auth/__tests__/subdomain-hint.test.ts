import { describe, it, expect } from "vitest";
import { sessionSubdomainHint } from "../subdomain-hint";

/** Simula um request. `sanitized` = middleware rodou (seta x-pathname). */
function reqWith(
  url: string,
  opts: { subdomain?: string; sanitized?: boolean } = {}
): Request {
  const headers = new Headers();
  if (opts.subdomain !== undefined) headers.set("x-org-subdomain", opts.subdomain);
  // Middleware seta x-pathname em toda rota do matcher.
  if (opts.sanitized) headers.set("x-pathname", new URL(url).pathname);
  return new Request(url, { headers });
}

describe("sessionSubdomainHint", () => {
  it("máquina (viaSession=false) → null, mesmo com header presente", () => {
    const req = reqWith("https://remax-trio.imobpro.ia.br/api/events", {
      subdomain: "remax-trio",
      sanitized: true,
    });
    expect(sessionSubdomainHint(req, false)).toBeNull();
  });

  it("sessão em rota sanitizada (matcher) → lê o header", () => {
    const req = reqWith("https://remax-trio.imobpro.ia.br/api/contracts/x", {
      subdomain: "remax-trio",
      sanitized: true,
    });
    expect(sessionSubdomainHint(req, true)).toBe("remax-trio");
  });

  it("REGRESSÃO round 5: rota FUNDA de forms (matcher) NÃO perde o hint", () => {
    // /api/forms/[token]/lock|participants|rotate-links são rotas do matcher.
    for (const path of ["/api/forms/tok/lock", "/api/forms/tok/participants", "/api/forms/tok/rotate-links"]) {
      const req = reqWith(`https://remax-trio.imobpro.ia.br${path}`, {
        subdomain: "remax-trio",
        sanitized: true,
      });
      expect(sessionSubdomainHint(req, true)).toBe("remax-trio");
    }
  });

  it("rota FORA do matcher (sem x-pathname) → null", () => {
    const req = reqWith("https://remax-trio.imobpro.ia.br/f/tok", {
      subdomain: "remax-trio",
      sanitized: false,
    });
    expect(sessionSubdomainHint(req, true)).toBeNull();
  });

  it("/api/auth (sessão) → null mesmo com x-pathname forjado (guarda reliable via req.url)", () => {
    const req = reqWith("https://imobpro.ia.br/api/auth/permissions", {
      subdomain: "remax-trio",
      sanitized: true, // simula x-pathname forjado numa rota não-matcher
    });
    expect(sessionSubdomainHint(req, true)).toBeNull();
  });

  it("sessão em rota sanitizada sem header (apex) → null", () => {
    const req = reqWith("https://imobpro.ia.br/pipeline", { sanitized: true });
    expect(sessionSubdomainHint(req, true)).toBeNull();
  });
});
