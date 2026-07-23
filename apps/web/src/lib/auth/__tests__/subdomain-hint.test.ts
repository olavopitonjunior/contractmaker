import { describe, it, expect } from "vitest";
import {
  sessionSubdomainHint,
  isMiddlewareSanitizedPath,
} from "../subdomain-hint";

function reqWith(url: string, subdomain?: string): Request {
  const headers = new Headers();
  if (subdomain !== undefined) headers.set("x-org-subdomain", subdomain);
  return new Request(url, { headers });
}

describe("sessionSubdomainHint", () => {
  it("máquina (viaSession=false) → null, mesmo com header presente", () => {
    const req = reqWith("https://remax-trio.imobpro.ia.br/api/events", "remax-trio");
    expect(sessionSubdomainHint(req, false)).toBeNull();
  });

  it("sessão em rota sanitizada (matcher) → lê o header", () => {
    const req = reqWith("https://remax-trio.imobpro.ia.br/api/contracts/x", "remax-trio");
    expect(sessionSubdomainHint(req, true)).toBe("remax-trio");
  });

  it("sessão em rota FORA do matcher (/api/auth/*) → null (header não sanitizado, forjável)", () => {
    const req = reqWith("https://imobpro.ia.br/api/auth/permissions", "remax-trio");
    expect(sessionSubdomainHint(req, true)).toBeNull();
  });

  it("sessão em rota sanitizada sem header (apex) → null", () => {
    const req = reqWith("https://imobpro.ia.br/pipeline");
    expect(sessionSubdomainHint(req, true)).toBeNull();
  });

  it("máquina em /api/auth → null (dupla proteção)", () => {
    const req = reqWith("https://imobpro.ia.br/api/auth/permissions", "x");
    expect(sessionSubdomainHint(req, false)).toBeNull();
  });

  it("sessão em outras rotas fora do matcher (/f, /p, /api/forms) → null", () => {
    for (const path of ["/f/tok", "/p/tok", "/api/forms/tok"]) {
      const req = reqWith(`https://remax-trio.imobpro.ia.br${path}`, "remax-trio");
      expect(sessionSubdomainHint(req, true)).toBeNull();
    }
  });
});

describe("isMiddlewareSanitizedPath", () => {
  it("rotas do matcher → true", () => {
    for (const p of ["/pipeline", "/api/contracts/x", "/settings", "/api/deals/1"]) {
      expect(isMiddlewareSanitizedPath(p)).toBe(true);
    }
  });

  it("prefixos excluídos do matcher → false (espelha middleware.ts)", () => {
    for (const p of [
      "/api/auth/permissions",
      "/api/forms/tok",
      "/f/tok",
      "/p/tok",
    ]) {
      expect(isMiddlewareSanitizedPath(p)).toBe(false);
    }
  });
});
