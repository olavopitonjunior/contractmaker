/**
 * Regressão do achado ALTO do security review do RAG global.
 *
 * As rotas /api/admin/support/knowledge/[id] são gateadas em
 * `PlatformRole = "support"` e escrevem com `orgId = null`. Enquanto a base de
 * suporte morava numa org-sentinela, isso alcançava no máximo aquela org; com
 * `orgId IS NULL` passaria a alcançar a base UNIVERSAL inteira — incluindo
 * `legislation`/`clause`/`rule`, que /api/admin/knowledge reserva ao
 * `super_admin`. `scopeCategory` é o que fecha isso, e é o que estes testes
 * travam: o filtro tem que chegar no `where`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateKnowledgeItem, deleteKnowledgeItem } from "../knowledge";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = prisma as unknown as {
  knowledgeItem: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.knowledgeItem.findFirst.mockResolvedValue({
    id: "k1",
    orgId: null,
    category: "support",
    title: "t",
    content: "c",
    tags: [],
    source: null,
    chunkTotal: 1,
    agentNotes: null,
    groupCode: null,
    subcategory: null,
    isVariable: false,
    status: "approved",
    usageCount: 0,
  });
  mockPrisma.knowledgeItem.update.mockResolvedValue({});
  mockPrisma.knowledgeItem.deleteMany.mockResolvedValue({ count: 1 });
});

describe("scopeCategory tranca a escrita numa base específica", () => {
  it("update com scopeCategory filtra a categoria no lookup", async () => {
    await updateKnowledgeItem(
      "k1",
      null,
      { title: "novo", allowPlatformScope: true },
      { scopeCategory: "support" }
    );
    expect(mockPrisma.knowledgeItem.findFirst).toHaveBeenCalledWith({
      where: { id: "k1", orgId: null, category: "support" },
    });
  });

  it("delete com scopeCategory filtra a categoria no deleteMany", async () => {
    await deleteKnowledgeItem("k1", null, {
      allowPlatformScope: true,
      scopeCategory: "support",
    });
    expect(mockPrisma.knowledgeItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "k1", orgId: null, category: "support" },
    });
  });

  it("sem scopeCategory o where não ganha categoria — /admin/knowledge escreve em todas", async () => {
    await deleteKnowledgeItem("k1", null, { allowPlatformScope: true });
    expect(mockPrisma.knowledgeItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "k1", orgId: null },
    });
  });

  it("um item jurídico não é encontrado pelo escopo do suporte", async () => {
    // O findFirst filtrado por category='support' não casa com a linha jurídica:
    // é assim que a rota do suporte responde 404 em vez de reescrever a base
    // universal de cláusulas.
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(null);
    await expect(
      updateKnowledgeItem(
        "clausula-da-plataforma",
        null,
        { content: "texto adulterado", allowPlatformScope: true },
        { scopeCategory: "support" }
      )
    ).rejects.toThrow(/não encontrado/i);
    expect(mockPrisma.knowledgeItem.update).not.toHaveBeenCalled();
  });
});
