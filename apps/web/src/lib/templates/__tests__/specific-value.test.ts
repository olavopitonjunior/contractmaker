import { describe, expect, it } from "vitest";
import { isSpecificValue, normalizeSpaces } from "../specific-value";

describe("isSpecificValue — o que pode ser trocado em TODAS as ocorrências", () => {
  it("moeda BRL, com espaço comum ou NBSP", () => {
    expect(isSpecificValue("R$ 2.500,00")).toBe(true);
    expect(isSpecificValue("R$ 2.500,00")).toBe(true);
    expect(isSpecificValue("R$ 31,67")).toBe(true);
    expect(isSpecificValue("R$ 1.250.000,00")).toBe(true);
    expect(isSpecificValue("R$")).toBe(false);
  });

  it("CPF e CNPJ só com dígito verificador válido — é o que separa documento real de boilerplate", () => {
    expect(isSpecificValue("529.982.247-25")).toBe(true);
    expect(isSpecificValue("52998224725")).toBe(true);
    expect(isSpecificValue("000.000.000-00")).toBe(false); // placeholder de máscara
    expect(isSpecificValue("123.456.789-00")).toBe(false);
    expect(isSpecificValue("64.524.938/0001-93")).toBe(true);
    expect(isSpecificValue("00.000.000/0000-00")).toBe(false);
  });

  it("CEP e datas (numérica e por extenso)", () => {
    expect(isSpecificValue("04538-132")).toBe(true);
    expect(isSpecificValue("04538132")).toBe(true);
    expect(isSpecificValue("10/08/2021")).toBe(true);
    expect(isSpecificValue("10 de agosto de 2021")).toBe(true);
    expect(isSpecificValue("1º de julho de 2026")).toBe(true);
    expect(isSpecificValue("agosto de 2021")).toBe(false);
  });

  it("o padrão número + extenso que o sistema produz", () => {
    expect(isSpecificValue("10 (dez)")).toBe(true);
    expect(isSpecificValue("10% (dez por cento)")).toBe(true);
    expect(isSpecificValue("3 (três)")).toBe(true);
    expect(isSpecificValue("30 (trinta)")).toBe(true);
    expect(isSpecificValue("10")).toBe(false);
    expect(isSpecificValue("(dez)")).toBe(false);
  });

  it("valor por extenso em reais é específico (é o par do numérico, nas mesmas cláusulas)", () => {
    expect(isSpecificValue("três mil e quinhentos reais")).toBe(true);
    expect(isSpecificValue("um milhão, duzentos e cinquenta mil reais")).toBe(true);
    expect(isSpecificValue("dez reais")).toBe(false); // curto demais
    expect(isSpecificValue("em reais")).toBe(false);
  });

  it("texto longo é específico por si; texto curto genérico não", () => {
    expect(isSpecificValue("Avenida Brigadeiro Faria Lima, nº 3500, apto. 121, Itaim Bibi")).toBe(true);
    expect(isSpecificValue("casa")).toBe(false); // "casa de máquinas"
    expect(isSpecificValue("São Paulo")).toBe(false);
    expect(isSpecificValue("IGP-M")).toBe(false);
    expect(isSpecificValue("")).toBe(false);
  });

  it("normalizeSpaces troca só o NBSP", () => {
    expect(normalizeSpaces("R$ 3.500,00 x")).toBe("R$ 3.500,00 x");
  });
});
