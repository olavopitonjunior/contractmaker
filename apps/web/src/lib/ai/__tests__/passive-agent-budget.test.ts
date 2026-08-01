/**
 * O teto por agente tem que valer NA ANÁLISE PASSIVA.
 *
 * Ela é o motivo de o teto por agente existir: roda sozinha no `open` de cada
 * contrato e em poll de 90s, e mediu 64% do custo de IA de produção. Enquanto
 * `assertAgentBudget` só era chamado no runner dos especialistas, o campo "Teto
 * mensal" que o console oferece pra "Análise automática" era controle inerte —
 * o operador configurava e nada acontecia.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPassiveAnalysis } from "../agent";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";
import { createAnthropicTextResponse } from "@/__tests__/helpers";
import { __resetAgentProfileCacheForTests } from "../agents/resolve";

const mockPrisma = vi.mocked(prisma);
let mockCreate: ReturnType<typeof vi.fn>;

function perfil(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    model: null,
    fallbackModel: null,
    temperature: null,
    maxTokens: null,
    instructions: null,
    ragScope: null,
    monthlyBudgetUsd: null,
    config: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  const instance = new Anthropic();
  mockCreate = vi.mocked(instance.messages.create);
  mockCreate.mockResolvedValue(createAnthropicTextResponse('{"findings": []}'));

  mockPrisma.contract.findUniqueOrThrow.mockResolvedValue({
    id: "contract-1",
    status: "rascunho",
    dealId: "deal-1",
    htmlContent: "<p>Contrato</p>",
    googleDocId: null,
    dataJson: {},
    template: null,
    deal: { kind: "venda" },
    lastAnalyzedTextHash: null,
  } as never);
  mockPrisma.contractComment.count.mockResolvedValue(0);
  mockPrisma.contractComment.findMany.mockResolvedValue([]);
  mockPrisma.contractComment.upsert = vi.fn().mockResolvedValue({});
  mockPrisma.contract.update.mockResolvedValue({} as never);
  mockPrisma.contract.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  mockPrisma.agentProfile.findFirst.mockResolvedValue(perfil() as never);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null as never);
  mockPrisma.aIUsage.aggregate.mockResolvedValue({
    _sum: { estimatedCostUsd: 0, totalTokens: 0 },
  } as never);
});

const run = () =>
  runPassiveAnalysis({ contractId: "contract-1", orgId: "org-1", trigger: "open" });

describe("runPassiveAnalysis — teto por agente", () => {
  it("no teto, não chama o modelo", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue(
      perfil({ monthlyBudgetUsd: 3 }) as never
    );
    mockPrisma.aIUsage.aggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: 3.5, totalTokens: 0 },
    } as never);

    const r = await run();
    expect(r.modelUsed).toBe("agent-budget-exceeded");
    expect(r.findings).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("abaixo do teto, roda normalmente", async () => {
    mockPrisma.agentProfile.findUnique.mockResolvedValue(
      perfil({ monthlyBudgetUsd: 3 }) as never
    );
    mockPrisma.aIUsage.aggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: 0.5, totalTokens: 0 },
    } as never);

    const r = await run();
    expect(r.modelUsed).not.toBe("agent-budget-exceeded");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("sem teto configurado, nem consulta o gasto", async () => {
    // A passiva roda em poll de 90s por aba aberta: um aggregate mensal à toa
    // nesse caminho é custo de banco recorrente, não detalhe.
    await run();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const chamadasDeCusto = mockPrisma.aIUsage.aggregate.mock.calls.filter(
      (c) => (c[0] as { where?: { agentKey?: string } })?.where?.agentKey === "passive"
    );
    expect(chamadasDeCusto).toHaveLength(0);
  });
});
