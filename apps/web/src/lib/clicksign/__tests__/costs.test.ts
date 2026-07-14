import { describe, it, expect, afterEach } from "vitest";
import {
  costCentsForMethod,
  envelopeCostCents,
  getMonthlyBudgetCents,
  CLICKSIGN_COST_CENTS,
} from "../costs";

describe("costs — per-org overrides + budget", () => {
  const origEnv = process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS;
  afterEach(() => {
    process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS = origEnv;
  });

  it("costCentsForMethod usa override quando presente", () => {
    expect(costCentsForMethod("email")).toBe(CLICKSIGN_COST_CENTS.email);
    expect(costCentsForMethod("email", { email: 99 })).toBe(99);
    // override inválido (negativo/não-número) cai no default.
    expect(costCentsForMethod("email", { email: -1 })).toBe(
      CLICKSIGN_COST_CENTS.email
    );
    expect(costCentsForMethod("whatsapp", { email: 99 })).toBe(
      CLICKSIGN_COST_CENTS.whatsapp
    );
  });

  it("envelopeCostCents soma por método com overrides", () => {
    expect(envelopeCostCents(["email", "email"])).toBe(
      CLICKSIGN_COST_CENTS.email * 2
    );
    expect(envelopeCostCents(["email", "whatsapp"], { email: 100, whatsapp: 200 })).toBe(
      300
    );
  });

  it("getMonthlyBudgetCents: override per-org > env > default", () => {
    process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS = "5000";
    expect(getMonthlyBudgetCents(12345)).toBe(12345); // per-org vence
    expect(getMonthlyBudgetCents(null)).toBe(5000); // cai no env
    expect(getMonthlyBudgetCents(0)).toBe(5000); // 0 não é válido → env
    delete process.env.CLICKSIGN_MONTHLY_BUDGET_CENTS;
    expect(getMonthlyBudgetCents(null)).toBe(10000); // default
  });
});
