/**
 * `usageCount` era global. Enquanto todo item tinha dono isso era inócuo; com a
 * base de plataforma deixou de ser: o `expert-context` ordena as top-8
 * cláusulas por popularidade e injeta o resultado no prompt de TODO turn em
 * modo Planejar. Um tenant inserindo a mesma cláusula universal muitas vezes
 * deslocava o preâmbulo do agente de outro tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { incrementClauseUsage, usageCountsForOrg } from "../knowledge-usage";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { update: ReturnType<typeof vi.fn> };
  knowledgeItemUsage: {
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.knowledgeItem.update.mockResolvedValue({});
  mockPrisma.knowledgeItemUsage.upsert.mockResolvedValue({});
  mockPrisma.knowledgeItemUsage.findMany.mockResolvedValue([]);
});

describe("incrementClauseUsage", () => {
  it("conta nos dois lugares: global e por org", async () => {
    // O global segue alimentando a tela de cláusulas e o find_similar_contracts.
    await incrementClauseUsage("k1", "org-1");

    expect(mockPrisma.knowledgeItem.update).toHaveBeenCalledWith({
      where: { id: "k1" },
      data: { usageCount: { increment: 1 } },
    });
    expect(mockPrisma.knowledgeItemUsage.upsert).toHaveBeenCalledWith({
      where: { knowledgeItemId_orgId: { knowledgeItemId: "k1", orgId: "org-1" } },
      create: { knowledgeItemId: "k1", orgId: "org-1", count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it("usa upsert, não leitura-seguida-de-escrita", async () => {
    // Dois turns simultâneos no mesmo contrato colidiriam na janela entre ler
    // e criar; o @@unique + upsert resolve no banco.
    await incrementClauseUsage("k1", "org-1");
    const call = mockPrisma.knowledgeItemUsage.upsert.mock.calls[0][0];
    expect(call.where).toHaveProperty("knowledgeItemId_orgId");
  });

  it("sem org, conta só o global", async () => {
    await incrementClauseUsage("k1", null);
    expect(mockPrisma.knowledgeItem.update).toHaveBeenCalled();
    expect(mockPrisma.knowledgeItemUsage.upsert).not.toHaveBeenCalled();
  });

  it("falha na contagem não propaga — não pode derrubar a inserção da cláusula", async () => {
    mockPrisma.knowledgeItem.update.mockRejectedValue(new Error("db fora"));
    mockPrisma.knowledgeItemUsage.upsert.mockRejectedValue(new Error("db fora"));
    await expect(incrementClauseUsage("k1", "org-1")).resolves.toBeUndefined();
  });
});

describe("usageCountsForOrg", () => {
  it("devolve o mapa id → contagem daquela org", async () => {
    mockPrisma.knowledgeItemUsage.findMany.mockResolvedValue([
      { knowledgeItemId: "k1", count: 7 },
      { knowledgeItemId: "k2", count: 2 },
    ]);
    const m = await usageCountsForOrg("org-1", ["k1", "k2"]);
    expect(m.get("k1")).toBe(7);
    expect(m.get("k2")).toBe(2);
  });

  it("lista vazia não consulta o banco", async () => {
    const m = await usageCountsForOrg("org-1", []);
    expect(m.size).toBe(0);
    expect(mockPrisma.knowledgeItemUsage.findMany).not.toHaveBeenCalled();
  });

  it("item sem uso naquela org simplesmente não aparece no mapa", async () => {
    // O caller trata ausência como zero — cláusula de plataforma nasce sem
    // histórico local e ganha espaço no preâmbulo por mérito, não por
    // popularidade alheia.
    mockPrisma.knowledgeItemUsage.findMany.mockResolvedValue([]);
    const m = await usageCountsForOrg("org-1", ["k1"]);
    expect(m.get("k1")).toBeUndefined();
  });
});
