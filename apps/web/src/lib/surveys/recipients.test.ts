import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveDealRecipients } from "./recipients";

const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const leaseFind = prisma.leaseContract.findFirst as unknown as ReturnType<
  typeof vi.fn
>;

function dealRow(over: Record<string, unknown> = {}) {
  return {
    id: "deal1",
    kind: "venda",
    pipeline: { orgId: "org1" },
    form: {
      dataJson: {
        vendedores: [{ nome: "Maria", email: "maria@ex.com" }],
      },
    },
    user: { name: "Corretor Um", email: "corretor@ex.com", phone: "(11) 99876-5432" },
    ...over,
  };
}

describe("resolveDealRecipients — corretor ganha telefone real", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaseFind.mockResolvedValue(null);
  });

  it("corretor com telefone cadastrado sai com phone normalizado (não mais null)", async () => {
    dealFind.mockResolvedValue(dealRow());
    const result = await resolveDealRecipients("deal1");
    const corretor = result!.recipients.find((r) => r.role === "corretor");
    expect(corretor).toEqual({
      role: "corretor",
      name: "Corretor Um",
      email: "corretor@ex.com",
      phone: "11998765432",
    });
  });

  it("corretor sem telefone segue com phone null (canal cai no fallback de e-mail)", async () => {
    dealFind.mockResolvedValue(
      dealRow({ user: { name: "Sem Fone", email: "sf@ex.com", phone: null } })
    );
    const result = await resolveDealRecipients("deal1");
    const corretor = result!.recipients.find((r) => r.role === "corretor");
    expect(corretor?.phone).toBeNull();
    expect(corretor?.email).toBe("sf@ex.com");
  });

  it("telefone lixo (curto demais) não vira alvo de WhatsApp", async () => {
    dealFind.mockResolvedValue(
      dealRow({ user: { name: "X", email: "x@ex.com", phone: "1234" } })
    );
    const result = await resolveDealRecipients("deal1");
    expect(
      result!.recipients.find((r) => r.role === "corretor")?.phone
    ).toBeNull();
  });

  it("partes continuam vindo do form (venda) junto do corretor", async () => {
    dealFind.mockResolvedValue(dealRow());
    const result = await resolveDealRecipients("deal1");
    expect(result!.dealKind).toBe("venda");
    expect(result!.recipients.map((r) => r.role)).toEqual([
      "vendedor",
      "corretor",
    ]);
  });

  it("locação sem partes no form mantém o fallback relacional", async () => {
    dealFind.mockResolvedValue(
      dealRow({ kind: "locacao", form: { dataJson: {} } })
    );
    leaseFind.mockResolvedValue({
      tenants: [{ tenant: { nome: "Inquilino", email: "in@ex.com", phone: null } }],
      property: {
        ownerships: [
          { owner: { nome: "Dono", email: null, phone: "11333322221" } },
        ],
      },
    });
    const result = await resolveDealRecipients("deal1");
    expect(result!.recipients.map((r) => r.role)).toEqual([
      "locatario",
      "locador",
      "corretor",
    ]);
  });

  it("deal inexistente → null", async () => {
    dealFind.mockResolvedValue(null);
    expect(await resolveDealRecipients("nope")).toBeNull();
  });
});
