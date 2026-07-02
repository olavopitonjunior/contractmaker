import { describe, it, expect } from "vitest";
import { computeMonthlyIrrf, resolveIrrfTable } from "../irrf";

describe("computeMonthlyIrrf", () => {
  it("0 quando a imobiliária não retém", () => {
    expect(computeMonthlyIrrf(5000, "fisica", "nao_retem", 2026)).toBe(0);
    expect(computeMonthlyIrrf(5000, "fisica", "retem_inquilino", 2026)).toBe(0);
  });

  it("0 para locador PJ", () => {
    expect(computeMonthlyIrrf(5000, "juridica", "retem_imobiliaria", 2026)).toBe(0);
  });

  it("0 na faixa isenta (PF, retém)", () => {
    expect(computeMonthlyIrrf(2000, "fisica", "retem_imobiliaria", 2026)).toBe(0);
  });

  it("faixa 15% (base 3000): 3000×0.15 − 381.44 = 68.56", () => {
    expect(computeMonthlyIrrf(3000, "fisica", "retem_imobiliaria", 2026)).toBeCloseTo(68.56, 2);
  });

  it("faixa 27,5% (base 5000): 5000×0.275 − 896 = 479", () => {
    expect(computeMonthlyIrrf(5000, "fisica", "retem_imobiliaria", 2026)).toBeCloseTo(479, 2);
  });

  it("base zero/negativa → 0", () => {
    expect(computeMonthlyIrrf(0, "fisica", "retem_imobiliaria", 2026)).toBe(0);
  });

  it("resolveIrrfTable cai no ano mais recente quando o ano não existe", () => {
    expect(resolveIrrfTable(1999).length).toBeGreaterThan(0);
  });
});
