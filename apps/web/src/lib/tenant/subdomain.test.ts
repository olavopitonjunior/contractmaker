import { describe, it, expect } from "vitest";
import {
  extractSubdomain,
  isReservedSubdomain,
  subdomainSchema,
} from "./subdomain";

describe("extractSubdomain", () => {
  const ROOT = "imobpro.ia.br";

  it.each([
    ["alpha.imobpro.ia.br", "alpha"],
    ["imobpro.ia.br", null],
    ["www.imobpro.ia.br", null],
    ["admin.imobpro.ia.br", null], // reservado
    ["api.imobpro.ia.br", null], // reservado
    ["alpha.localhost", "alpha"],
    ["alpha.localhost:3000", "alpha"],
    ["localhost", null],
    ["localhost:3000", null],
    ["preview-xyz.vercel.app", null],
    ["192.168.0.1", null],
    ["", null],
    ["alpha.beta.imobpro.ia.br", "alpha"], // só o 1º label
  ])("host %s → %s", (host, expected) => {
    expect(extractSubdomain(host, ROOT)).toBe(expected);
  });

  it("é case-insensitive", () => {
    expect(extractSubdomain("ALPHA.imobpro.ia.br", ROOT)).toBe("alpha");
  });
});

describe("isReservedSubdomain", () => {
  it("pega reservados independente de caixa", () => {
    expect(isReservedSubdomain("www")).toBe(true);
    expect(isReservedSubdomain("ADMIN")).toBe(true);
    expect(isReservedSubdomain("alpha")).toBe(false);
  });
});

describe("subdomainSchema", () => {
  it("aceita válidos", () => {
    expect(subdomainSchema.safeParse("imobiliaria-x").success).toBe(true);
    expect(subdomainSchema.safeParse("alpha123").success).toBe(true);
  });
  it("rejeita curto, reservado, e formato inválido", () => {
    expect(subdomainSchema.safeParse("ab").success).toBe(false);
    expect(subdomainSchema.safeParse("www").success).toBe(false);
    expect(subdomainSchema.safeParse("-foo").success).toBe(false);
    expect(subdomainSchema.safeParse("foo_bar").success).toBe(false);
  });
});
