import { describe, it, expect } from "vitest";
import {
  costCentsForMethod,
  envelopeCostCents,
  CLICKSIGN_COST_CENTS,
} from "../costs";

// `getMonthlyBudgetCents` saiu junto com o teto mensal — o limite real é o do
// plano da conta ClickSign (ver quota.test.ts). O que resta aqui só alimenta
// `Envelope.costCents` (telemetria interna, nada em tela).
describe("costs — estimativa interna por método", () => {
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
});
