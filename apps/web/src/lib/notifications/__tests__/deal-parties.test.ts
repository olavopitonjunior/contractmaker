import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveDealParties } from "../deal-parties";

const leaseFind = prisma.leaseContract.findFirst as unknown as ReturnType<
  typeof vi.fn
>;

describe("resolveDealParties — titulares contactáveis do negócio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaseFind.mockResolvedValue(null);
  });

  it("venda: vendedores + compradores do form, com papel e contato normalizados", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "venda",
      formDataJson: {
        vendedores: [
          { nome: "Maria Souza", email: "  Maria@Ex.COM ", mobile_phone: "(11) 98765-4321" },
        ],
        compradores: [{ razao_social: "Acme LTDA", telefone: "1133334444" }],
      },
    });
    expect(parties).toEqual([
      {
        key: "party:maria@ex.com",
        role: "vendedor",
        label: "Maria Souza",
        email: "maria@ex.com",
        phone: "11987654321",
      },
      {
        key: "party:1133334444",
        role: "comprador",
        label: "Acme LTDA",
        email: null,
        phone: "1133334444",
      },
    ]);
  });

  it("parte sem e-mail e sem telefone fica de fora (não há canal)", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "venda",
      formDataJson: { vendedores: [{ nome: "Só Nome" }] },
    });
    expect(parties).toEqual([]);
  });

  it("dedup: mesmo e-mail em duas listas vira um destinatário só", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "venda",
      formDataJson: {
        vendedores: [{ nome: "João", email: "joao@ex.com" }],
        compradores: [{ nome: "Joao Silva", email: "joao@ex.com", mobile_phone: "11999998888" }],
      },
    });
    expect(parties).toHaveLength(1);
    expect(parties[0].role).toBe("vendedor"); // primeira ocorrência manda
    // a segunda ocorrência só COMPLETA o contato que faltava
    expect(parties[0].phone).toBe("11999998888");
  });

  it("dedup por telefone quando o e-mail não bate (um dos dois está vazio)", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "locacao",
      formDataJson: {
        locadores: [{ nome: "Ana", mobile_phone: "11 91234-5678" }],
        locatarios: [{ nome: "Ana Paula", telefone: "11912345678", email: "ana@ex.com" }],
      },
    });
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      role: "locador",
      email: "ana@ex.com",
      phone: "11912345678",
    });
  });

  it("locação sem partes no form cai no fallback relacional do LeaseContract", async () => {
    leaseFind.mockResolvedValue({
      tenants: [
        { tenant: { nome: "Locatário Um", email: "loc@ex.com", phone: "11888887777" } },
      ],
      property: {
        ownerships: [
          { owner: { nome: "Proprietário Um", email: null, phone: "1133332222" } },
        ],
      },
    });
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "locacao",
      formDataJson: {},
    });
    expect(leaseFind).toHaveBeenCalledTimes(1);
    expect(parties.map((p) => [p.role, p.key])).toEqual([
      ["locatario", "party:loc@ex.com"],
      ["locador", "party:1133332222"],
    ]);
  });

  it("locação COM partes no form não consulta o LeaseContract", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "locacao",
      formDataJson: { locatarios: [{ nome: "Zé", email: "ze@ex.com" }] },
    });
    expect(leaseFind).not.toHaveBeenCalled();
    expect(parties).toHaveLength(1);
  });

  it("venda nunca cai no fallback de locação, mesmo sem partes", async () => {
    const parties = await resolveDealParties({
      dealId: "deal1",
      dealKind: "venda",
      formDataJson: null,
    });
    expect(leaseFind).not.toHaveBeenCalled();
    expect(parties).toEqual([]);
  });
});
