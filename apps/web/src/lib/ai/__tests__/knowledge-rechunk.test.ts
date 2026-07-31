/**
 * Editar um item MULTI-CHUNK atualizava só a linha-pai — que guarda um preview
 * de 500 chars e não tem embedding. As filhas, únicas linhas que a busca
 * semântica encontra, ficavam com texto e vetor antigos indefinidamente: a tela
 * confirmava "Item atualizado" e o agente citava a versão anterior pra sempre.
 *
 * É defeito pré-existente que a base de plataforma amplificou — um item errado
 * deixou de afetar um tenant e passou a afetar todos.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { updateKnowledgeItem } from "../knowledge";

const embedMock = vi.fn().mockResolvedValue([[0.1, 0.2]]);
vi.mock("../embeddings", () => ({
  embed: (...args: unknown[]) => embedMock(...args),
  toPgVector: (v: unknown) => JSON.stringify(v),
  isEmbeddingsConfigured: () => true,
}));

const mockPrisma = prisma as unknown as {
  knowledgeItem: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
};

const LONGO = "Cláusula de garantia locatícia. ".repeat(400);

function itemAtual(over: Record<string, unknown> = {}) {
  return {
    id: "k1",
    orgId: "org-1",
    category: "legislation",
    title: "Título antigo",
    content: "preview antigo",
    chunkTotal: 5,
    tags: ["a"],
    source: "manual",
    createdBy: "u1",
    visibleToAgents: ["editor"],
    agentNotes: null,
    groupCode: null,
    subcategory: null,
    isVariable: false,
    status: "approved",
    usageCount: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  embedMock.mockResolvedValue([[0.1, 0.2]]);
  mockPrisma.knowledgeItem.update.mockResolvedValue({});
  mockPrisma.knowledgeItem.deleteMany.mockResolvedValue({ count: 5 });
  mockPrisma.knowledgeItem.findMany.mockResolvedValue([]);
  let n = 0;
  mockPrisma.knowledgeItem.create.mockImplementation(async () => ({ id: `child-${n++}` }));
  // `$transaction(fn)` roda o callback com o próprio mock — basta pro teste
  // observar quais escritas aconteceram lá dentro.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(mockPrisma)
  );
  mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
});

describe("edição de item multi-chunk", () => {
  it("apaga as filhas e recria com o texto novo", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual());

    await updateKnowledgeItem("k1", "org-1", { content: LONGO });

    expect(mockPrisma.knowledgeItem.deleteMany).toHaveBeenCalledWith({
      where: { parentId: "k1" },
    });
    expect(mockPrisma.knowledgeItem.create).toHaveBeenCalled();
    const primeiraFilha = mockPrisma.knowledgeItem.create.mock.calls[0][0].data;
    expect(primeiraFilha.parentId).toBe("k1");
    expect(primeiraFilha.content).toContain("Cláusula de garantia");
  });

  it("as filhas novas herdam a visibilidade do pai", async () => {
    // Sem isto a restrição sumiria no re-chunk — e é a filha que a busca vê.
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual());

    await updateKnowledgeItem("k1", "org-1", { content: LONGO });

    for (const call of mockPrisma.knowledgeItem.create.mock.calls) {
      expect(call[0].data.visibleToAgents).toEqual(["editor"]);
    }
  });

  it("reembeda as filhas — e FORA da transação", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual());

    await updateKnowledgeItem("k1", "org-1", { content: LONGO });

    expect(embedMock).toHaveBeenCalled();
    // Segurar transação do Prisma através de chamada de rede à Voyage é P2028
    // esperando acontecer: o embed roda depois que a transação fecha.
    const txOrder = mockPrisma.$transaction.mock.invocationCallOrder[0];
    const embedOrder = embedMock.mock.invocationCallOrder[0];
    expect(embedOrder).toBeGreaterThan(txOrder);
  });

  it("mudar SÓ o título reembeda sem re-chunkar", async () => {
    // O texto embutido é `título + conteúdo`, então o vetor fica inválido —
    // mas o corte do texto continua bom.
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual());
    mockPrisma.knowledgeItem.findMany.mockResolvedValue([
      { id: "c1", content: "pedaço um" },
      { id: "c2", content: "pedaço dois" },
    ]);

    await updateKnowledgeItem("k1", "org-1", { title: "Título novo" });

    expect(mockPrisma.knowledgeItem.deleteMany).not.toHaveBeenCalled();
    expect(embedMock).toHaveBeenCalled();
    expect(embedMock.mock.calls[0][0]).toEqual([
      "Título novo\n\npedaço um",
      "Título novo\n\npedaço dois",
    ]);
  });

  it("patch que não toca título nem conteúdo não reembeda nada", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual());

    await updateKnowledgeItem("k1", "org-1", { tags: ["b"] });

    expect(embedMock).not.toHaveBeenCalled();
    expect(mockPrisma.knowledgeItem.deleteMany).not.toHaveBeenCalled();
  });

  it("item de uma linha continua no caminho simples", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(itemAtual({ chunkTotal: 1 }));

    await updateKnowledgeItem("k1", "org-1", { content: "texto curto novo" });

    expect(mockPrisma.knowledgeItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
  });
});
