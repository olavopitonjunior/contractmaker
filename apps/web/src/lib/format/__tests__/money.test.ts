import { describe, it, expect } from "vitest";
import { formatMoneyBR, parseMoneyBR, parsePercentBR } from "../money";

describe("parseMoneyBR", () => {
  it.each([
    // [entrada, esperado]
    ["1.500.000,00", 1500000],
    ["850000,50", 850000.5],
    ["850.000", 850000],
    ["850.000,50", 850000.5],
    ["R$ 850.000", 850000],
    ["R$ 1.234.567,89", 1234567.89],
    // Os casos do bug 100× — NÃO podem mais inflar:
    ["1000.00", 1000],
    ["1.5", 1.5],
    ["100.5", 100.5],
    ["1500.00", 1500],
    ["1.500", 1500], // ponto com 3 dígitos = milhar → 1500 (não 1,5)
    ["999.500", 999500], // grupo de milhar de 3 dígitos antes
    // Casos do re-review: 3 dígitos após NÃO viram milhar quando o antes é 0
    // (percentual) ou tem 4+ dígitos (decimal US):
    ["0.750", 0.75], // 0,75% — NÃO 750
    ["0.5", 0.5],
    ["1234.567", 1234.567], // decimal US de 3 casas — NÃO 1234567
    // Plain / inteiros:
    ["1000", 1000],
    ["0", 0],
    ["", 0],
    // Numéricos passam direto:
    [1234.56, 1234.56],
    [0, 0],
    // Negativos:
    ["-1.500,00", -1500],
  ])("parseMoneyBR(%p) === %p", (input, expected) => {
    expect(parseMoneyBR(input as string | number)).toBe(expected);
  });

  it("lixo / tipos inesperados → 0", () => {
    expect(parseMoneyBR(null as unknown as string)).toBe(0);
    expect(parseMoneyBR(undefined as unknown as string)).toBe(0);
    expect(parseMoneyBR({} as unknown as string)).toBe(0);
    expect(parseMoneyBR("abc")).toBe(0);
  });

  it("NÃO infla o valor 100× (regressão do bug reportado)", () => {
    // Antes: "1000.00" → 100000. Agora tem que ser 1000.
    expect(parseMoneyBR("1000.00")).not.toBe(100000);
    expect(parseMoneyBR("1000.00")).toBe(1000);
  });
});

describe("parsePercentBR", () => {
  it.each([
    ["6", 6],
    ["6,5", 6.5],
    ["6.5", 6.5],
    // Porcentagem nunca tem milhar — ponto/vírgula é sempre decimal:
    ["6.500", 6.5], // NÃO 6500
    ["6,500", 6.5],
    ["0.750", 0.75],
    ["100", 100],
    ["", 0],
    [6.5, 6.5],
    ["-1,5", -1.5],
  ])("parsePercentBR(%p) === %p", (input, expected) => {
    expect(parsePercentBR(input as string | number)).toBe(expected);
  });

  it("NÃO infla o percentual ~1000× (regressão do 3º review)", () => {
    // "6.500" (6,5%) NÃO pode virar 6500 (comissão ~1000× maior).
    expect(parsePercentBR("6.500")).toBe(6.5);
  });
});

describe("formatMoneyBR", () => {
  it.each([
    [0, "R$ 0,00"],
    [1500, "R$ 1.500,00"],
    [1500.5, "R$ 1.500,50"],
    [1234567.89, "R$ 1.234.567,89"],
    [-250.4, "-R$ 250,40"],
    ["2500", "R$ 2.500,00"],
    ["1.500,50", "R$ 1.500,50"],
  ])("formatMoneyBR(%p) === %p", (input, expected) => {
    expect(formatMoneyBR(input)).toBe(expected);
  });

  it("usa separadores ASCII (sem NBSP do Intl) pra não quebrar hidratação", () => {
    expect(formatMoneyBR(1000)).not.toMatch(/\u00a0/);
  });
});
