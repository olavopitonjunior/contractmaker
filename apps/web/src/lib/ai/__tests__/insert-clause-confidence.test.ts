/**
 * Piso de confiança no `insert_clause` por ID EXPLÍCITO.
 *
 * O caminho `clauseQuery` sempre teve fail-safe (similaridade ≥ 0.4). O de id
 * pulava tudo — e como `query_knowledge_base` devolve topK SEM piso (marca
 * `lowConfidence` em vez de esconder, pra não regredir recall), o modelo
 * recebia um id fraco e podia inseri-lo direto no contrato. Era backlog
 * registrado no próprio tool-handlers.
 *
 * O gate é estreito de propósito: só recusa com evidência POSITIVA de que o id
 * é ruim. E não vale pra plano aprovado por humano.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeToolHandler } from "../tool-handlers";
import type { AgentContext } from "../types";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contractClause: { create: ReturnType<typeof vi.fn> };
};

const ID = "clx1234567890abcdefghijkl";

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    contractId: "c1",
    userId: "u1",
    orgId: "org-1",
    htmlContent: "<p>contrato</p>",
    dataJson: {},
    templateSource: "",
    templateModalidade: "a_vista",
    templateName: "t",
    activeClauses: [],
    ...over,
  } as AgentContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.knowledgeItem.findFirst.mockResolvedValue({
    id: ID,
    title: "Cláusula de garantia",
    content: "<p>texto da cláusula</p>",
    groupCode: "G1",
    subcategory: "garantia",
    orgId: "org-1",
  });
  mockPrisma.knowledgeItem.update.mockResolvedValue({});
  mockPrisma.contractClause.create.mockResolvedValue({ id: "cc1" });
});

async function insert(context: AgentContext) {
  return (await executeToolHandler(
    "insert_clause",
    { knowledgeItemId: ID },
    context
  )) as { success?: boolean; hint?: string; error?: string };
}

describe("insert_clause por id explícito", () => {
  it("RECUSA id que a busca deste turn marcou como baixa confiança", async () => {
    const r = await insert(ctx({ ragConfidence: { [ID]: true } }));
    expect(r.success).toBe(false);
    expect(r.hint).toBe("low_confidence_explicit_id");
    // Instrutivo, não só negativo: aponta o caminho de saída.
    expect(r.error).toContain("clauseQuery");
    expect(mockPrisma.contractClause.create).not.toHaveBeenCalled();
  });

  it("aceita id que a busca marcou como confiável", async () => {
    const r = await insert(ctx({ ragConfidence: { [ID]: false } }));
    expect(r.success).toBe(true);
  });

  it("aceita id NÃO visto neste turn — ausência de prova não é prova de ausência", async () => {
    // O id pode vir do histórico da conversa ou de outra tool. Exigir
    // proveniência confiável quebraria caso legítimo.
    const r = await insert(ctx({ ragConfidence: {} }));
    expect(r.success).toBe(true);
  });

  it("plano APROVADO por humano passa mesmo com id fraco", async () => {
    // Quem leu o título no PlanCard já endossou; o gate aqui transformaria
    // aprovação humana em no_match e regrediria o plan-and-approve.
    const r = await insert(ctx({ ragConfidence: { [ID]: true }, humanApprovedPlan: true }));
    expect(r.success).toBe(true);
  });

  it("sem registro de confiança no contexto, nada muda (compat)", async () => {
    const r = await insert(ctx());
    expect(r.success).toBe(true);
  });
});
