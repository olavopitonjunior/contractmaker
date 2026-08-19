import { describe, it, expect, afterEach } from "vitest";
import { proposalPublicLink } from "../public-link";

const ORIGINAL = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL;
});

describe("proposalPublicLink", () => {
  it("usa NEXTAUTH_URL quando presente", () => {
    process.env.NEXTAUTH_URL = "https://staging.imobpro.ia.br";
    expect(proposalPublicLink("tok123")).toBe("https://staging.imobpro.ia.br/p/tok123");
  });

  it("remove barra final da base", () => {
    process.env.NEXTAUTH_URL = "https://imobpro.ia.br/";
    expect(proposalPublicLink("tok123")).toBe("https://imobpro.ia.br/p/tok123");
  });

  it("fallback é PRODUÇÃO quando a env var falta — nunca staging", () => {
    delete process.env.NEXTAUTH_URL;
    expect(proposalPublicLink("tok123")).toBe("https://imobpro.ia.br/p/tok123");
  });

  it("env var vazia também cai no fallback de produção (|| e não ??)", () => {
    process.env.NEXTAUTH_URL = "";
    expect(proposalPublicLink("tok123")).toBe("https://imobpro.ia.br/p/tok123");
  });
});
