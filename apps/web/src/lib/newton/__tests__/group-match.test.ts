import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  normalizePhone,
  extractPartyPhones,
  matchDealGroup,
} from "@/lib/newton/group-match";

const mockPrisma = vi.mocked(prisma);

beforeEach(() => vi.clearAllMocks());

describe("normalizePhone", () => {
  it("11 dígitos (DDD+9) → prefixa 55", () => {
    expect(normalizePhone("11987654321")).toBe("5511987654321");
  });
  it("já com 55 → mantém", () => {
    expect(normalizePhone("5511987654321")).toBe("5511987654321");
  });
  it("com máscara/+ → só dígitos", () => {
    expect(normalizePhone("+55 (11) 98765-4321")).toBe("5511987654321");
  });
  it("curto demais → null", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("extractPartyPhones", () => {
  it("lê vendedores/compradores mobile_phone + lead.phones, dedup", () => {
    const deal = {
      id: "d1",
      userId: "u1",
      dataJson: null,
      form: {
        dataJson: {
          vendedores: [{ mobile_phone: "11987654321" }],
          compradores: [{ mobile_phone: "(11) 91111-2222" }],
        },
      },
      fromLead: { phones: ["+5511987654321"] }, // dup do vendedor
    };
    const phones = extractPartyPhones(deal as never);
    expect(phones).toContain("5511987654321");
    expect(phones).toContain("5511911112222");
    expect(phones.length).toBe(2); // dedup do vendedor repetido no lead
  });
});

const baseDeal = {
  id: "d1",
  userId: "neg1",
  dataJson: null,
  form: {
    orgId: "org-1",
    dataJson: {
      vendedores: [{ mobile_phone: "11987654321" }],
      compradores: [{ mobile_phone: "11911112222" }],
    },
  },
  pipeline: { orgId: "org-1" },
  fromLead: null,
};

function setupCommon() {
  mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
  mockPrisma.dealGroupLink.findUnique.mockResolvedValue(null as never);
  mockPrisma.orgMembership.findMany.mockResolvedValue([
    { user: { phone: "5511999999999" } }, // operador da org (excluído)
  ] as never);
  mockPrisma.user.findUnique.mockResolvedValue({ phone: "5511999999999" } as never); // negociador
}

describe("matchDealGroup", () => {
  it("match forte (2 telefones-cliente, único grupo) → grava DealGroupLink", async () => {
    setupCommon();
    mockPrisma.whatsappGroupMember.findMany.mockResolvedValue([
      { phone: "5511987654321", group: { groupId: "g-A", name: "Yamamoto" } },
      { phone: "5511911112222", group: { groupId: "g-A", name: "Yamamoto" } },
    ] as never);

    const r = await matchDealGroup("d1");
    expect(r.linked).toBe(true);
    expect(r.groupId).toBe("g-A");
    expect(mockPrisma.dealGroupLink.upsert).toHaveBeenCalledOnce();
  });

  it("match fraco (1 telefone) → NÃO grava, devolve candidatos", async () => {
    setupCommon();
    mockPrisma.whatsappGroupMember.findMany.mockResolvedValue([
      { phone: "5511987654321", group: { groupId: "g-A", name: "Yamamoto" } },
    ] as never);

    const r = await matchDealGroup("d1");
    expect(r.linked).toBe(false);
    expect(r.candidates[0]).toMatchObject({ groupId: "g-A", hits: 1 });
    expect(mockPrisma.dealGroupLink.upsert).not.toHaveBeenCalled();
  });

  it("empate no topo (2 grupos com 2 hits) → NÃO grava (ambíguo)", async () => {
    setupCommon();
    mockPrisma.whatsappGroupMember.findMany.mockResolvedValue([
      { phone: "5511987654321", group: { groupId: "g-A", name: "A" } },
      { phone: "5511911112222", group: { groupId: "g-A", name: "A" } },
      { phone: "5511987654321", group: { groupId: "g-B", name: "B" } },
      { phone: "5511911112222", group: { groupId: "g-B", name: "B" } },
    ] as never);

    const r = await matchDealGroup("d1");
    expect(r.linked).toBe(false);
    expect(mockPrisma.dealGroupLink.upsert).not.toHaveBeenCalled();
  });

  it("única parte é o negociador → excluído, nem consulta membros", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      form: {
        orgId: "org-1",
        dataJson: { vendedores: [{ mobile_phone: "5511999999999" }], compradores: [] },
      },
    } as never);
    mockPrisma.dealGroupLink.findUnique.mockResolvedValue(null as never);
    mockPrisma.orgMembership.findMany.mockResolvedValue([
      { user: { phone: "5511999999999" } },
    ] as never);
    mockPrisma.user.findUnique.mockResolvedValue({ phone: "5511999999999" } as never);

    const r = await matchDealGroup("d1");
    expect(r.linked).toBe(false);
    expect(mockPrisma.whatsappGroupMember.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dealGroupLink.upsert).not.toHaveBeenCalled();
  });

  it("já vinculado → idempotente, não regrava", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.dealGroupLink.findUnique.mockResolvedValue({ groupId: "g-X" } as never);

    const r = await matchDealGroup("d1");
    expect(r.linked).toBe(true);
    expect(r.groupId).toBe("g-X");
    expect(mockPrisma.dealGroupLink.upsert).not.toHaveBeenCalled();
  });
});
