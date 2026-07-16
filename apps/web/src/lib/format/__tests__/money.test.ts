import { describe, it, expect } from "vitest";
import { parseMoneyBR } from "../money";

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
