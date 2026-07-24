import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveDealBrokers } from "../deal-brokers";

const rosterFind = prisma.splitRecipient.findMany as unknown as ReturnType<
  typeof vi.fn
>;

function recipient(over: Record<string, unknown>) {
  return {
    id: "sr1",
    orgId: "org1",
    label: "Corretor Um",
    cpfCnpj: "11122233344",
    ownerCpfCnpj: null,
    ownerName: null,
    email: "um@x.com",
    phone: "+5511999999999",
    kind: "commissioner",
    active: true,
    pendingFields: [] as string[],
    notifyByEmail: true,
    notifyByWhatsapp: false,
    notifyOptOut: false,
    ...over,
  };
}

describe("resolveDealBrokers — comissionados do form × registry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("match por splitRecipientId explícito", async () => {
    rosterFind.mockResolvedValue([recipient({})]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: {
        comissao: { comissionados: [{ nome: "Outro Nome", splitRecipientId: "sr1" }] },
      },
      brokerIds: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].splitRecipientId).toBe("sr1");
  });

  it("match por CPF normalizado (form com máscara)", async () => {
    rosterFind.mockResolvedValue([recipient({})]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: {
        comissao: { comissionados: [{ nome: "X", cpf: "111.222.333-44" }] },
      },
      brokerIds: [],
    });
    expect(out).toHaveLength(1);
  });

  it("match por nome normalizado (diacríticos/caixa)", async () => {
    rosterFind.mockResolvedValue([
      recipient({ cpfCnpj: null, label: "José da Silva" }),
    ]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: {
        comissao: { comissionados: [{ nome: "  jose DA silva " }] },
      },
      brokerIds: [],
    });
    expect(out).toHaveLength(1);
  });

  it("rascunho inativo (pendingFields) É elegível; desativado real NÃO", async () => {
    rosterFind.mockResolvedValue([
      recipient({ id: "draft", active: false, pendingFields: ["walletId"] }),
      recipient({
        id: "dead",
        active: false,
        pendingFields: [],
        cpfCnpj: "99988877766",
        label: "Desativado",
      }),
    ]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: {
        comissao: {
          comissionados: [{ cpf: "11122233344" }, { cpf: "99988877766" }],
        },
      },
      brokerIds: [],
    });
    expect(out.map((b) => b.splitRecipientId)).toEqual(["draft"]);
  });

  it("notifyOptOut exclui o corretor", async () => {
    rosterFind.mockResolvedValue([recipient({ notifyOptOut: true })]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: { comissao: { comissionados: [{ cpf: "11122233344" }] } },
      brokerIds: [],
    });
    expect(out).toHaveLength(0);
  });

  it("mesmo doc em linha ativa e duplicata desativada → só a ativa", async () => {
    rosterFind.mockResolvedValue([
      recipient({ id: "dup-inativa", active: false, pendingFields: ["walletId"] }),
      recipient({ id: "ativa" }),
    ]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: { comissao: { comissionados: [{ cpf: "11122233344" }] } },
      brokerIds: [],
    });
    expect(out.map((b) => b.splitRecipientId)).toEqual(["ativa"]);
  });

  it("brokerIds explícitos entram e deduplicam com o match do form", async () => {
    rosterFind.mockResolvedValue([
      recipient({}),
      recipient({ id: "sr2", cpfCnpj: "55566677788", label: "Corretora Dois" }),
    ]);
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: { comissao: { comissionados: [{ cpf: "11122233344" }] } },
      brokerIds: ["sr1", "sr2"],
    });
    expect(out.map((b) => b.splitRecipientId).sort()).toEqual(["sr1", "sr2"]);
  });

  it("sem comissionados nem brokerIds → [] sem consultar o roster", async () => {
    const out = await resolveDealBrokers({
      orgId: "org1",
      formDataJson: null,
      brokerIds: [],
    });
    expect(out).toEqual([]);
    expect(rosterFind).not.toHaveBeenCalled();
  });
});
