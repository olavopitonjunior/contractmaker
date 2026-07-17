import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  assertContractBudget,
  getOrgAiBudgetStatus,
  OrgAiBudgetExceededError,
} from "../budget";

vi.mock("@/lib/notifications/emit", () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}));
import { emitNotification } from "@/lib/notifications/emit";

const usageAgg = prisma.aIUsage.aggregate as unknown as ReturnType<typeof vi.fn>;
const finSettings = prisma.orgFinancialSettings.findFirst as unknown as ReturnType<typeof vi.fn>;
const contractFind = prisma.contract.findUnique as unknown as ReturnType<typeof vi.fn>;
const emit = emitNotification as unknown as ReturnType<typeof vi.fn>;

function mockAggSequence(perContractTokens: number, orgUsd: number) {
  // 1ª chamada: tokens do contrato; 2ª: custo USD da org no mês.
  usageAgg
    .mockResolvedValueOnce({ _sum: { totalTokens: perContractTokens } })
    .mockResolvedValueOnce({ _sum: { estimatedCostUsd: orgUsd } });
}

beforeEach(() => {
  vi.clearAllMocks();
  contractFind.mockResolvedValue({
    deal: { pipeline: { orgId: "org1" } },
  });
});

describe("budget mensal de IA da org", () => {
  it("sem teto configurado → passa e não notifica", async () => {
    finSettings.mockResolvedValue(null);
    mockAggSequence(1000, 999);
    await expect(assertContractBudget("c1")).resolves.toBeTruthy();
    expect(emit).not.toHaveBeenCalled();
  });

  it("≥100% do teto → OrgAiBudgetExceededError (mensagem da org) + sino 100", async () => {
    finSettings.mockResolvedValue({ aiMonthlyBudgetUsd: 50 });
    mockAggSequence(1000, 55);
    await expect(assertContractBudget("c1")).rejects.toThrow(OrgAiBudgetExceededError);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai_budget_threshold",
        batchId: expect.stringMatching(/^ai-budget:org1:\d{4}-\d{2}:100$/),
      })
    );
  });

  it("80-99% → sino de 80 e o chat SEGUE", async () => {
    finSettings.mockResolvedValue({ aiMonthlyBudgetUsd: 100 });
    mockAggSequence(1000, 85);
    await expect(assertContractBudget("c1")).resolves.toBeTruthy();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: expect.stringMatching(/:80$/),
      })
    );
  });

  it("falha na resolução da org NÃO bloqueia o chat", async () => {
    contractFind.mockRejectedValue(new Error("db down"));
    usageAgg.mockResolvedValueOnce({ _sum: { totalTokens: 1000 } });
    await expect(assertContractBudget("c1")).resolves.toBeTruthy();
  });

  it("getOrgAiBudgetStatus calcula pct", async () => {
    finSettings.mockResolvedValue({ aiMonthlyBudgetUsd: 200 });
    usageAgg.mockResolvedValueOnce({ _sum: { estimatedCostUsd: 50 } });
    const s = await getOrgAiBudgetStatus("org1");
    expect(s).toMatchObject({ budgetUsd: 200, spentUsd: 50, pct: 0.25 });
  });
});
