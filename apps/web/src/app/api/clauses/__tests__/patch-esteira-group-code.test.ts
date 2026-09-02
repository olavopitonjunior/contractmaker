/**
 * `PATCH /api/clauses/[id]` não pode GRAVAR `esteira='venda'` junto de um
 * `groupCode` que não é do roteiro do CCV.
 *
 * Por quê: `clauseWriteSchema` restringe `groupCode` a G1..G6, mas
 * `scripts/seed-acervo-clausulas.ts` o declara `z.string()` livre, e o acervo
 * curado de LOCAÇÃO entrou em produção com 'GARANTIA' e 'OPCIONAL'. Um PATCH
 * que mandava só `esteira` preservava o grupo do banco verbatim — e o par
 * ('venda' + 'GARANTIA') faz a cláusula sumir da busca do agente num contrato
 * de locação, porque o filtro do RAG é
 * `esteira IN (<a do contrato>,'ambas') OR esteira IS NULL`. Sem erro, sem log.
 *
 * O teste afirma a NEGAÇÃO — que o estado não é gravado — e não apenas que um
 * detector o detecta depois.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { PATCH } from "../[id]/route";
import { POST } from "../route";

vi.mock("@/lib/ai/knowledge", () => ({
  updateKnowledgeItem: vi.fn().mockResolvedValue(undefined),
  createKnowledgeItem: vi.fn().mockResolvedValue({ id: "novo-1" }),
}));

import { updateKnowledgeItem, createKnowledgeItem } from "@/lib/ai/knowledge";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/clauses/cl1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** Forma REAL de produção: acervo curado de locação com groupCode 'GARANTIA'. */
function curadaDeLocacao(over: Record<string, unknown> = {}) {
  return {
    id: "cl1",
    orgId: "org-1",
    category: "clause",
    title: "Garantia — Fiador",
    content: "texto sem chave",
    tags: ["slot:garantia", "garantia:fiador"],
    source: "manual", // manual pra não esbarrar na trava de tags congeladas
    subcategory: "garantia",
    groupCode: "GARANTIA",
    esteira: "locacao",
    agentNotes: null,
    isVariable: false,
    status: "approved",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
  (getUserOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "org-1" });
  mockPrisma.knowledgeItem.findUnique.mockResolvedValue(curadaDeLocacao());
});

describe("PATCH /api/clauses/[id] — esteira × groupCode", () => {
  it("mandar só esteira='venda' NÃO deixa 'GARANTIA' sobreviver", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(curadaDeLocacao());

    const res = await PATCH(req({ esteira: "venda" }), { params: { id: "cl1" } });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: "venda", groupCode: null })
    );
  });

  it("grupo legítimo do CCV sobrevive em venda", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(
      curadaDeLocacao({ groupCode: "G4", esteira: "venda", tags: [] })
    );

    const res = await PATCH(req({ title: "Financiamento e registro" }), {
      params: { id: "cl1" },
    });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: "venda", groupCode: "G4" })
    );
  });

  it("sair de venda para locação limpa o grupo junto", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(
      curadaDeLocacao({ groupCode: "G4", esteira: "venda", tags: [] })
    );

    const res = await PATCH(req({ esteira: "locacao" }), { params: { id: "cl1" } });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: "locacao", groupCode: null })
    );
  });

  it("a taxonomia do curador sobrevive fora de venda", async () => {
    // 'GARANTIA' é o eixo legítimo do acervo curado, e a migration de correção
    // o preserva de propósito (move a esteira, nunca o grupo). Se a guarda o
    // apagasse, o primeiro PATCH em qualquer das 37 linhas consertadas
    // desfaria o conserto pela metade — achado de review.
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(curadaDeLocacao());

    const res = await PATCH(req({ title: "Garantia — Fiador solidário" }), {
      params: { id: "cl1" },
    });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: "locacao", groupCode: "GARANTIA" })
    );
  });
});

describe("POST /api/clauses — esteira × groupCode", () => {
  function postReq(body: unknown) {
    return new NextRequest("http://localhost/api/clauses", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("criar com par incoerente não grava o grupo", async () => {
    // `clauseWriteSchema` valida os dois campos SEPARADAMENTE e aceita o par.
    // Era o único caminho de escrita que ainda criava o estado que o PATCH e o
    // classificador recusam.
    const res = await POST(
      postReq({
        title: "Vistoria de entrada",
        content: "O imóvel será vistoriado na entrega das chaves.",
        esteira: "locacao",
        groupCode: "G4",
      })
    );

    expect(res.status).toBe(201);
    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ esteira: "locacao", groupCode: null })
    );
  });

  it("CONTROLE: par coerente grava o grupo", async () => {
    const res = await POST(
      postReq({
        title: "Financiamento e registro",
        content: "O saldo será quitado por financiamento bancário.",
        esteira: "venda",
        groupCode: "G4",
      })
    );

    expect(res.status).toBe(201);
    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ esteira: "venda", groupCode: "G4" })
    );
  });
});
