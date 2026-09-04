import { describe, it, expect, afterEach, vi } from "vitest";
import {
  FICHACERTA_BUDGET_DEFAULT_CENTS,
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

  it("Ficha Certa: env própria, default R$ 3.000 (freio da plataforma, não saldo da conta)", () => {
    vi.stubEnv("FICHACERTA_MONTHLY_BUDGET_CENTS", "");
    expect(monthlyBudgetCents("fichacerta")).toBe(FICHACERTA_BUDGET_DEFAULT_CENTS);
    expect(FICHACERTA_BUDGET_DEFAULT_CENTS).toBe(300000);
    vi.stubEnv("FICHACERTA_MONTHLY_BUDGET_CENTS", "777");
    expect(monthlyBudgetCents("fichacerta")).toBe(777);
    // A env de um provider não vaza no outro.
    vi.stubEnv("SERASA_MONTHLY_BUDGET_CENTS", "");
    expect(monthlyBudgetCents("serasa")).toBe(SERASA_BUDGET_DEFAULT_CENTS);
  });

  it("monthlySpendWhere filtra pelo provider pedido", () => {
    expect(monthlySpendWhere("org1", "fichacerta", new Date(0)).provider).toBe("fichacerta");
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
