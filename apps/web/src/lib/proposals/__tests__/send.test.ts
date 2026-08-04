import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getSignatureSettings } from "@/lib/clicksign/account";
import { prepareSend } from "../send";

vi.mock("@/lib/clicksign/account", async (orig) => {
  const real = await orig<typeof import("@/lib/clicksign/account")>();
  return { ...real, getSignatureSettings: vi.fn() };
});

const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerFind = prisma.proposalSigner.findMany as unknown as ReturnType<typeof vi.fn>;
const settingsMock = getSignatureSettings as unknown as ReturnType<typeof vi.fn>;

const CREDS = { token: "t", baseUrl: "https://app.clicksign.com" };
const deps = {
  resolveCreds: async () => CREDS,
  getSpent: async () => 0,
};

function settings(over: Record<string, unknown> = {}) {
  return {
    orgId: "org1", monthlyBudgetCents: 100000, proposalBudgetCents: null,
    costOverridesJson: null, acceptanceEnabled: false,
    whatsappSignatureAvailable: null, acceptanceWhatsappAvailable: null,
    ...over,
  };
}
const okSigner = (over = {}) => ({
  name: "Marcia Souza", email: "marcia@gmail.com", cpf: null, phone: "11987654321",
  notifyChannel: "email", signingGroup: 1, role: "proponente", included: true, ...over,
});

describe("prepareSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `dataJson` com conteúdo: desde 2026-08-04 o prepareSend também barra
    // proposta cujo DOCUMENTO sairia vazio (ver checkProposalContent).
    propFind.mockResolvedValue({
      orgId: "org1",
      hiddenPaths: [],
      schemaType: "compra_venda_v1",
      dataJson: {
        compradores: [{ nome: "Fulano de Tal" }],
        imoveis: [{ endereco: "Rua X, 1" }],
        pagamento: { valor_total: 500000 },
      },
    });
    settingsMock.mockResolvedValue(settings());
  });

  it("sem conta ClickSign → not_configured", async () => {
    const r = await prepareSend("p1", { ...deps, resolveCreds: async () => null });
    expect(r).toEqual({ blocked: "not_configured" });
  });

  it("sem signatários → no_signers", async () => {
    signerFind.mockResolvedValue([]);
    expect(await prepareSend("p1", deps)).toEqual({ blocked: "no_signers" });
  });

  it("preflight falha (nome de 1 palavra) → blocked preflight", async () => {
    signerFind.mockResolvedValue([okSigner({ name: "Marcia" })]);
    const r = await prepareSend("p1", deps);
    expect(r).toMatchObject({ blocked: "preflight" });
  });

  it("mesmo CPF em grupos diferentes → collision", async () => {
    signerFind.mockResolvedValue([
      okSigner({ cpf: "11144477735", signingGroup: 1, role: "proponente" }),
      okSigner({ name: "Outro Nome", cpf: "11144477735", signingGroup: 2, role: "vendedor" }),
    ]);
    const r = await prepareSend("p1", deps);
    expect(r).toMatchObject({ blocked: "collision" });
  });

  it("caminho feliz e-mail → envelope, custo reservado", async () => {
    signerFind.mockResolvedValue([okSigner(), okSigner({ name: "José Silva", email: "jose@gmail.com", signingGroup: 2, role: "vendedor" })]);
    const r = await prepareSend("p1", deps);
    expect(r).toMatchObject({ ok: true, instrument: "envelope" });
    if ("ok" in r) expect(r.planCostCents).toBe(300); // 2 × R$1,50 email
  });

  it("não-Plus + WhatsApp → Aceite (R$0,99/pessoa) com aviso", async () => {
    settingsMock.mockResolvedValue(settings({ acceptanceEnabled: true, whatsappSignatureAvailable: false }));
    signerFind.mockResolvedValue([
      okSigner({ notifyChannel: "whatsapp" }),
      okSigner({ name: "José Silva", email: "jose@gmail.com", notifyChannel: "whatsapp", signingGroup: 2, role: "vendedor" }),
    ]);
    const r = await prepareSend("p1", deps);
    expect(r).toMatchObject({ ok: true, instrument: "aceite" });
    if ("ok" in r) {
      expect(r.planCostCents).toBe(198); // 2 × 99
      expect(r.warnings.join(" ")).toMatch(/Aceite via WhatsApp/i);
    }
  });

  it("orçamento estourado → budget", async () => {
    signerFind.mockResolvedValue([okSigner()]);
    const r = await prepareSend("p1", { ...deps, getSpent: async () => 99900 });
    expect(r).toMatchObject({ blocked: "budget" });
  });

  it("sub-teto de propostas tem precedência sobre o mensal", async () => {
    settingsMock.mockResolvedValue(settings({ proposalBudgetCents: 100 })); // R$1
    signerFind.mockResolvedValue([okSigner()]); // custo 150 > 100
    const r = await prepareSend("p1", deps);
    expect(r).toMatchObject({ blocked: "budget", budgetCents: 100 });
  });
});
