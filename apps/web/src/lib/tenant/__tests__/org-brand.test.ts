import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
  },
}));

import { getOrgBrand, DEFAULT_BRAND_COLOR } from "../branding";
import { prisma } from "@/lib/db/prisma";

const findUnique = vi.mocked(prisma.organization.findUnique);

/** Molda o retorno do select de getOrgBrand. */
function org(over: {
  name?: string;
  legalName?: string | null;
  branding?: Record<string, unknown> | null;
  ownerEmail?: string | null;
}) {
  return {
    name: over.name ?? "RE/MAX Ativa",
    legalName: over.legalName ?? null,
    brandingSettings: over.branding ?? null,
    members: over.ownerEmail
      ? [{ user: { email: over.ownerEmail } }]
      : [],
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("getOrgBrand", () => {
  it("deriva nome e contato quando ninguém preencheu a identidade visual", async () => {
    // O caso da RE/MAX Ativa e da Trio: BrandingSettings existe mas está vazio.
    findUnique.mockResolvedValue(
      org({
        name: "RE/MAX Ativa",
        legalName: "Ativa Consultoria Imobiliaria Ltda",
        branding: { displayName: null, supportEmail: null, logoUrl: null, primaryColor: null },
        ownerEmail: "wesleycapozzi@remax.com.br",
      })
    );

    const brand = await getOrgBrand("org_1");

    // Nome FANTASIA, não razão social: é o que o cliente lê no e-mail e na /pay.
    expect(brand.displayName).toBe("RE/MAX Ativa");
    expect(brand.supportEmail).toBe("wesleycapozzi@remax.com.br");
    expect(brand.primaryColor).toBe(DEFAULT_BRAND_COLOR);
    expect(brand.logoUrl).toBeNull();
  });

  it("usa a razão social só quando a org não tem nome fantasia", async () => {
    findUnique.mockResolvedValue(
      org({ name: "", legalName: "NNI - Natrielli Ltda", branding: null })
    );

    const brand = await getOrgBrand("org_5");

    expect(brand.displayName).toBe("NNI - Natrielli Ltda");
  });

  it("o valor salvo vence o derivado", async () => {
    findUnique.mockResolvedValue(
      org({
        legalName: "Ativa Consultoria Imobiliaria Ltda",
        branding: {
          displayName: "RE/MAX Ativa",
          supportEmail: "contato@ativa.com.br",
          logoUrl: "https://blob/logo.png",
          primaryColor: "#DC1C2E",
        },
        ownerEmail: "wesleycapozzi@remax.com.br",
      })
    );

    const brand = await getOrgBrand("org_1");

    expect(brand.displayName).toBe("RE/MAX Ativa");
    expect(brand.supportEmail).toBe("contato@ativa.com.br");
    expect(brand.logoUrl).toBe("https://blob/logo.png");
    expect(brand.primaryColor).toBe("#DC1C2E");
  });

  it("cai no nome da org quando não há razão social", async () => {
    findUnique.mockResolvedValue(
      org({ name: "RE/MAX Trio", legalName: "", branding: null, ownerEmail: null })
    );

    const brand = await getOrgBrand("org_2");

    expect(brand.displayName).toBe("RE/MAX Trio");
    expect(brand.supportEmail).toBeNull();
  });

  it("org sem BrandingSettings não explode — devolve os defaults", async () => {
    findUnique.mockResolvedValue(org({ name: "Imobiliária Nova", branding: null }));

    const brand = await getOrgBrand("org_3");

    expect(brand.displayName).toBe("Imobiliária Nova");
    expect(brand.primaryColor).toBe(DEFAULT_BRAND_COLOR);
    expect(brand.poweredBy).toBe(true);
  });

  it("string vazia no banco conta como não-preenchido (não vira nome em branco)", async () => {
    findUnique.mockResolvedValue(
      org({
        name: "Imobiliária X",
        branding: { displayName: "   ", supportEmail: "", primaryColor: "" },
        ownerEmail: "dono@x.com.br",
      })
    );

    const brand = await getOrgBrand("org_4");

    expect(brand.displayName).toBe("Imobiliária X");
    expect(brand.supportEmail).toBe("dono@x.com.br");
    expect(brand.primaryColor).toBe(DEFAULT_BRAND_COLOR);
  });

  it("org inexistente devolve um fallback usável em vez de quebrar o e-mail", async () => {
    findUnique.mockResolvedValue(null as never);

    const brand = await getOrgBrand("sumiu");

    expect(brand.displayName).toBe("Imobiliária");
    expect(brand.primaryColor).toBe(DEFAULT_BRAND_COLOR);
  });
});
