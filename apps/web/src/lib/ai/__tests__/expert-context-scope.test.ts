/**
 * O preâmbulo (`expert-context`) é injetado antes do 1º turn de todo chat em
 * modo Planejar e carrega as top-8 cláusulas. Até 2026-07-31 ele era carregado
 * no `loadContextNode`, que roda ANTES do router — sem agente definido, e
 * portanto sem escopo. A tela dizia que o agente estava restrito; o preâmbulo
 * entregava a base inteira mesmo assim.
 *
 * Estes testes travam as duas metades: o escopo do perfil chega na query, e o
 * preâmbulo nunca derruba o turn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { loadExpertContext, expertContextFor } from "../expert-context";
import { __resetAgentProfileCacheForTests } from "../agents/resolve";
import type { AgentContext } from "../types";

vi.mock("../memory", () => ({ findSimilarContracts: vi.fn().mockResolvedValue([]) }));

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findMany: ReturnType<typeof vi.fn> };
  contractTemplate: { findMany: ReturnType<typeof vi.fn> };
  agentProfile: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

const ctx = {
  contractId: "c1",
  userId: "u1",
  orgId: "org-1",
  htmlContent: "",
  dataJson: {},
  templateSource: null,
  templateModalidade: "a_vista",
  activeClauses: [],
} as unknown as AgentContext;

/** Where da consulta de cláusulas do preâmbulo. */
function clauseWhere() {
  return mockPrisma.knowledgeItem.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  mockPrisma.knowledgeItem.findMany.mockResolvedValue([]);
  mockPrisma.contractTemplate.findMany.mockResolvedValue([]);
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null);
});

describe("expert-context respeita o escopo do agente", () => {
  it("sem agentKey, não filtra por visibilidade — comportamento de quem chama fora do orquestrador", async () => {
    await loadExpertContext(ctx);
    const and = clauseWhere().AND as Record<string, unknown>[];
    expect(JSON.stringify(and)).not.toContain("visibleToAgents");
  });

  it("com agentKey, o filtro de visibilidade entra na query", async () => {
    await loadExpertContext(ctx, "editor");
    const and = clauseWhere().AND as Record<string, unknown>[];
    expect(and).toContainEqual({
      OR: [
        { visibleToAgents: { isEmpty: true } },
        { visibleToAgents: { has: "editor" } },
      ],
    });
  });

  it("ragScope do perfil chega no preâmbulo — era o furo", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue({
      enabled: true,
      model: null,
      fallbackModel: null,
      temperature: null,
      maxTokens: null,
      instructions: null,
      ragScope: { includePlatform: false, tags: ["locacao"] },
      monthlyBudgetUsd: null,
      config: null,
    });

    await loadExpertContext(ctx, "editor");
    const and = clauseWhere().AND as Record<string, unknown>[];
    // includePlatform:false → escopo vira só a org, sem o OR da plataforma.
    expect(and).toContainEqual({ orgId: "org-1" });
    expect(and).toContainEqual({ tags: { hasSome: ["locacao"] } });
  });

  it("perfil indisponível não abre o escopo — mantém ao menos o filtro por agente", async () => {
    mockPrisma.agentProfile.findFirst.mockRejectedValue(new Error("db fora"));
    mockPrisma.agentProfile.findUnique.mockRejectedValue(new Error("db fora"));

    await loadExpertContext(ctx, "legal");
    const and = clauseWhere().AND as Record<string, unknown>[];
    expect(JSON.stringify(and)).toContain("visibleToAgents");
  });
});

describe("expertContextFor", () => {
  it("modo Rápido não carrega preâmbulo — o Rápido é enxuto de propósito", async () => {
    const out = await expertContextFor({ agentKey: "editor", mode: "fast", context: ctx });
    expect(out).toBe("");
    expect(mockPrisma.knowledgeItem.findMany).not.toHaveBeenCalled();
  });

  it("sem contexto carregado, devolve vazio em vez de estourar", async () => {
    const out = await expertContextFor({ agentKey: "editor", mode: "plan", context: undefined });
    expect(out).toBe("");
  });

  it("falha no carregamento não derruba o turn — preâmbulo é otimização", async () => {
    mockPrisma.knowledgeItem.findMany.mockRejectedValue(new Error("boom"));
    const out = await expertContextFor({ agentKey: "editor", mode: "plan", context: ctx });
    expect(out).toBe("");
  });
});
