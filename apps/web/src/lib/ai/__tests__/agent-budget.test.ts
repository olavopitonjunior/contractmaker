/**
 * Teto mensal POR AGENTE.
 *
 * O teto da org é bom pra impedir a conta explodir e ruim pra conter um agente
 * específico: uma análise passiva em loop consome o orçamento inteiro e derruba
 * o chat junto. Com teto por agente, o que estourou para — e só ele.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  assertAgentBudget,
  getAgentBudgetStatus,
  AgentBudgetExceededError,
} from "../budget";
import { __resetAgentProfileCacheForTests } from "../agents/resolve";

const mockPrisma = prisma as unknown as {
  agentProfile: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  aIUsage: { aggregate: ReturnType<typeof vi.fn> };
};

function perfilComTeto(usd: number | null) {
  return {
    enabled: true,
    model: null,
    fallbackModel: null,
    temperature: null,
    maxTokens: null,
    instructions: null,
    ragScope: null,
    monthlyBudgetUsd: usd,
    config: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null);
  mockPrisma.aIUsage.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 0 } });
});

describe("getAgentBudgetStatus", () => {
  it("sem teto configurado, NÃO consulta o gasto", async () => {
    // Este caminho roda antes de cada chamada ao modelo, e a maioria dos
    // agentes não tem teto — pagar um aggregate mensal à toa sairia caro.
    const s = await getAgentBudgetStatus("org-1", "editor");
    expect(s).toEqual({ budgetUsd: null, spentUsd: 0, pct: 0 });
    expect(mockPrisma.aIUsage.aggregate).not.toHaveBeenCalled();
  });

  it("com teto, soma o gasto DAQUELE agente no mês", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue(perfilComTeto(10));
    mockPrisma.aIUsage.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 4 } });

    const s = await getAgentBudgetStatus("org-1", "editor");
    expect(s.budgetUsd).toBe(10);
    expect(s.spentUsd).toBe(4);
    expect(s.pct).toBeCloseTo(0.4);

    const where = mockPrisma.aIUsage.aggregate.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    expect(where.agentKey).toBe("editor");
  });
});

describe("assertAgentBudget", () => {
  it("abaixo do teto, deixa passar", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue(perfilComTeto(10));
    mockPrisma.aIUsage.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 9.99 } });
    await expect(assertAgentBudget("org-1", "editor")).resolves.toBeUndefined();
  });

  it("no teto, bloqueia com mensagem que nomeia o agente", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue(perfilComTeto(10));
    mockPrisma.aIUsage.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 10 } });

    await expect(assertAgentBudget("org-1", "editor")).rejects.toThrow(
      AgentBudgetExceededError
    );
    // "o Editor atingiu o teto" resolve; "a IA atingiu o teto" manda o usuário
    // adivinhar qual e onde mexer.
    await expect(assertAgentBudget("org-1", "editor")).rejects.toThrow(/Editor/);
    await expect(assertAgentBudget("org-1", "editor")).rejects.toThrow(
      /demais agentes seguem funcionando/
    );
  });

  it("falha de LEITURA não bloqueia o turn", async () => {
    // Teto é contenção de custo, não de segurança: negar atendimento porque um
    // aggregate caiu é o pior dos dois erros.
    mockPrisma.agentProfile.findUnique.mockResolvedValue(perfilComTeto(10));
    mockPrisma.aIUsage.aggregate.mockRejectedValue(new Error("db fora"));
    await expect(assertAgentBudget("org-1", "editor")).resolves.toBeUndefined();
  });

  it("agente sem teto nunca bloqueia", async () => {
    await expect(assertAgentBudget("org-1", "analyst")).resolves.toBeUndefined();
  });
});
