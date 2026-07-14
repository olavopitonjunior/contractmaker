import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chargePublicLink: { findUnique: vi.fn(), create: vi.fn() },
    commissionCharge: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/security/crypto", () => ({
  generatePublicToken: () => "tok_fixo",
}));
vi.mock("@/lib/tenant/branding", () => ({
  getOrgBrand: vi.fn(),
}));

import { mintPublicLink } from "../publicPage";
import { prisma } from "@/lib/db/prisma";
import { getOrgBrand } from "@/lib/tenant/branding";

const mockGetBrand = vi.mocked(getOrgBrand);
const mockCharge = vi.mocked(prisma.commissionCharge.findUnique);
const mockLinkFind = vi.mocked(prisma.chargePublicLink.findUnique);
const mockLinkCreate = vi.mocked(prisma.chargePublicLink.create);

beforeEach(() => {
  vi.clearAllMocks();
  mockLinkFind.mockResolvedValue(null as never);
  mockCharge.mockResolvedValue({ id: "chg_1", orgId: "org_1" } as never);
  mockLinkCreate.mockImplementation(
    ((args: { data: { publicToken: string } }) => Promise.resolve(args.data)) as never
  );
});

describe("mintPublicLink — marca congelada no link público", () => {
  it("congela a marca da IMOBILIÁRIA (não da conta Asaas)", async () => {
    mockGetBrand.mockResolvedValue({
      displayName: "RE/MAX Ativa",
      logoUrl: "https://blob/logo.png",
      primaryColor: "#DC1C2E",
      supportEmail: "contato@ativa.com.br",
      supportPhone: "(19) 99999-0000",
      poweredBy: true,
    });

    await mintPublicLink("chg_1");

    expect(mockGetBrand).toHaveBeenCalledWith("org_1");
    const snapshot = (mockLinkCreate.mock.calls[0][0] as { data: { brandSnapshot: Record<string, unknown> } })
      .data.brandSnapshot;
    expect(snapshot.displayName).toBe("RE/MAX Ativa");
    expect(snapshot.logoUrl).toBe("https://blob/logo.png");
    expect(snapshot.primaryColor).toBe("#DC1C2E");
    expect(snapshot.supportEmail).toBe("contato@ativa.com.br");
    expect(snapshot.supportPhone).toBe("(19) 99999-0000");
  });

  it("org sem identidade visual ainda gera link com nome e cor default", async () => {
    // Antes, uma org SEM conta Asaas caía no nome cru e sem cor — hoje o resolver
    // deriva o nome da própria org.
    mockGetBrand.mockResolvedValue({
      displayName: "RE/MAX Trio",
      logoUrl: null,
      primaryColor: "#0f172a",
      supportEmail: "netonatrielli@remax.com.br",
      supportPhone: null,
      poweredBy: true,
    });

    await mintPublicLink("chg_1");

    const snapshot = (mockLinkCreate.mock.calls[0][0] as { data: { brandSnapshot: Record<string, unknown> } })
      .data.brandSnapshot;
    expect(snapshot.displayName).toBe("RE/MAX Trio");
    expect(snapshot.logoUrl).toBeNull();
    expect(snapshot.primaryColor).toBe("#0f172a");
  });

  it("link já existente não é re-mintado (a marca antiga é preservada)", async () => {
    mockLinkFind.mockResolvedValue({ publicToken: "tok_antigo" } as never);

    const token = await mintPublicLink("chg_1");

    expect(token).toBe("tok_antigo");
    expect(mockGetBrand).not.toHaveBeenCalled();
    expect(mockLinkCreate).not.toHaveBeenCalled();
  });
});
