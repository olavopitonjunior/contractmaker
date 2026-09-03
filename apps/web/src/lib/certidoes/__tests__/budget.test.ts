import { describe, it, expect, afterEach, vi } from "vitest";
import {
  INFOSIMPLES_BUDGET_DEFAULT_CENTS,
  SERASA_BUDGET_DEFAULT_CENTS,
  firstOfCurrentMonth,
  monthlyBudgetCents,
  monthlySpendWhere,
} from "../budget";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("monthlyBudgetCents — um só default", () => {
  it("Infosimples: R$ 200 quando a env não existe (o valor que sempre bloqueou de fato)", () => {
    vi.stubEnv("INFOSIMPLES_MONTHLY_BUDGET_CENTS", "");
    expect(monthlyBudgetCents("infosimples")).toBe(INFOSIMPLES_BUDGET_DEFAULT_CENTS);
    expect(INFOSIMPLES_BUDGET_DEFAULT_CENTS).toBe(20000);
  });

  it("env válida vence; lixo cai no default", () => {
    vi.stubEnv("INFOSIMPLES_MONTHLY_BUDGET_CENTS", "12345");
    expect(monthlyBudgetCents("infosimples")).toBe(12345);
    vi.stubEnv("INFOSIMPLES_MONTHLY_BUDGET_CENTS", "abc");
    expect(monthlyBudgetCents("infosimples")).toBe(20000);
    vi.stubEnv("SERASA_MONTHLY_BUDGET_CENTS", "");
    expect(monthlyBudgetCents("serasa")).toBe(SERASA_BUDGET_DEFAULT_CENTS);
  });
});

describe("monthlySpendWhere — uma só contagem", () => {
  it("conta jobs de deal da org E jobs sem deal (ad-hoc/LeaseClient) do mês", () => {
    const since = new Date(2026, 8, 1);
    expect(monthlySpendWhere("org-1", "infosimples", since)).toEqual({
      createdAt: { gte: since },
      provider: "infosimples",
      OR: [{ deal: { form: { orgId: "org-1" } } }, { orgId: "org-1" }],
    });
  });

  it("firstOfCurrentMonth zera dia/hora no fuso local", () => {
    const d = firstOfCurrentMonth(new Date(2026, 8, 17, 15, 30));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 1, 0]);
  });
});
