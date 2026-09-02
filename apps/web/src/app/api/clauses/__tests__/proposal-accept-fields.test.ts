/**
 * Aprovar uma `ClauseProposal` cria a cláusula de verdade — e este caminho não
 * tinha teste nenhum, apesar de ser dirigido por LLM de ponta a ponta.
 *
 * Dois campos são decididos aqui e ambos já estiveram errados:
 *
 * - `groupCode`: `propose_new_clause` aceita string livre, então o modelo pode
 *   gravar qualquer coisa na proposta. O que vira cláusula tem de passar pelo
 *   enum G1..G6 — e um grupo VÁLIDO declara a esteira, porque o conjunto é
 *   fechado e é o roteiro do CCV por definição.
 * - `isVariable`: era `!!proposal.groupCode`, sobra da época em que "ter grupo"
 *   e "ter placeholder" eram tratados como a mesma coisa. A migration
 *   20260901120000 trocou a semântica para derivar do CONTEÚDO e este caminho
 *   ficou para trás, gravando a antiga.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { PATCH } from "../proposals/[id]/route";

vi.mock("@/lib/ai/knowledge", () => ({
  createKnowledgeItem: vi.fn().mockResolvedValue({ id: "novo-1" }),
}));

import { createKnowledgeItem } from "@/lib/ai/knowledge";

const mockPrisma = prisma as unknown as {
  clauseProposal: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function req(action: string) {
  return new NextRequest("http://localhost/api/clauses/proposals/p1", {
    method: "PATCH",
    body: JSON.stringify({ action }),
    headers: { "Content-Type": "application/json" },
  });
}

function proposta(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    orgId: "org-1",
    title: "Cláusula de arras",
    content: "As arras de R$ 50.000,00 serão pagas na assinatura.",
    tags: ["tema:arras"],
    groupCode: "G1",
    category: "sinal",
    reason: "Usar quando houver sinal.",
    status: "pending",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
  (getUserOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "org-1" });
  mockPrisma.clauseProposal.update.mockResolvedValue({});
});

describe("PATCH /api/clauses/proposals/[id] — accept", () => {
  it("grupo válido do CCV sobrevive e declara a esteira de venda", async () => {
    mockPrisma.clauseProposal.findFirst.mockResolvedValue(proposta());

    const res = await PATCH(req("accept"), { params: { id: "p1" } });

    expect(res.status).toBe(200);
    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ groupCode: "G1", esteira: "venda" })
    );
  });

  it("grupo inventado pelo modelo não vira cláusula, e a esteira fica em triagem", async () => {
    mockPrisma.clauseProposal.findFirst.mockResolvedValue(
      proposta({ groupCode: "GARANTIA_ESPECIAL" })
    );

    const res = await PATCH(req("accept"), { params: { id: "p1" } });

    expect(res.status).toBe(200);
    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ groupCode: null, esteira: null })
    );
  });

  it("isVariable vem do CONTEÚDO, não da presença de grupo", async () => {
    // Sem grupo mas COM placeholder: a regra antiga (`!!proposal.groupCode`)
    // gravaria false aqui e true no caso oposto — os dois errados.
    mockPrisma.clauseProposal.findFirst.mockResolvedValue(
      proposta({ groupCode: null, content: "Valor de {{pagamento.sinal_valor}}." })
    );

    await PATCH(req("accept"), { params: { id: "p1" } });

    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ isVariable: true })
    );
  });

  it("com grupo mas SEM placeholder, isVariable é false", async () => {
    mockPrisma.clauseProposal.findFirst.mockResolvedValue(proposta());

    await PATCH(req("accept"), { params: { id: "p1" } });

    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ isVariable: false })
    );
  });
});
