import { describe, it, expect } from "vitest";
import {
  R01_LAYOUT,
  R04_LAYOUT,
  DIMOB_LINE_SEPARATOR,
} from "../layout";
import {
  formatField,
  serializeRecord,
  buildDimobFile,
  assertLayoutIntegrity,
  sanitizeText,
  toDdmmyyyy,
} from "../txt-writer";

/** Lê um campo pela chave a partir da linha serializada (posição derivada). */
function sliceField(layout: typeof R01_LAYOUT, line: string, key: string): string {
  const f = layout.fields.find((x) => x.key === key)!;
  return line.slice(f.start - 1, f.start - 1 + f.length);
}

describe("layout integrity", () => {
  it("R01 é contíguo e o totalLength bate com a soma dos campos", () => {
    expect(() => assertLayoutIntegrity(R01_LAYOUT)).not.toThrow();
    const sum = R01_LAYOUT.fields.reduce((a, f) => a + f.length, 0);
    expect(R01_LAYOUT.totalLength).toBe(sum);
  });

  it("R04 é contíguo e o totalLength bate com a soma dos campos", () => {
    expect(() => assertLayoutIntegrity(R04_LAYOUT)).not.toThrow();
    const sum = R04_LAYOUT.fields.reduce((a, f) => a + f.length, 0);
    expect(R04_LAYOUT.totalLength).toBe(sum);
  });

  it("posições iniciais são derivadas em sequência", () => {
    expect(R01_LAYOUT.fields[0].start).toBe(1);
    expect(R01_LAYOUT.fields[1].start).toBe(4); // após "R01"
  });
});

describe("sanitizeText", () => {
  it("remove acentos e força maiúsculas", () => {
    expect(sanitizeText("José da Conceição")).toBe("JOSE DA CONCEICAO");
  });
  it("troca caracteres fora do conjunto seguro por espaço e colapsa", () => {
    expect(sanitizeText("Imóvel #12 (bloco)")).toBe("IMOVEL 12 BLOCO");
  });
});

describe("toDdmmyyyy", () => {
  it("converte ISO YYYY-MM-DD para DDMMYYYY", () => {
    expect(toDdmmyyyy("2025-03-08")).toBe("08032025");
  });
  it("converte ISO com tempo", () => {
    expect(toDdmmyyyy("2025-12-31T12:00:00.000Z")).toBe("31122025");
  });
  it("converte Date (UTC)", () => {
    expect(toDdmmyyyy(new Date(Date.UTC(2024, 1, 5)))).toBe("05022024");
  });
  it("aceita DD/MM/YYYY e DDMMYYYY", () => {
    expect(toDdmmyyyy("08/03/2025")).toBe("08032025");
    expect(toDdmmyyyy("08032025")).toBe("08032025");
  });
  it("vazio/indeterminável => string vazia", () => {
    expect(toDdmmyyyy(null)).toBe("");
    expect(toDdmmyyyy("qualquer coisa")).toBe("");
  });
});

describe("formatField", () => {
  const f = (type: string, length: number, extra = {}) =>
    ({ key: "x", label: "x", start: 1, length, type, ...extra }) as never;

  it("text: à esquerda, espaço à direita, truncado", () => {
    expect(formatField(f("text", 5), "AB")).toBe("AB   ");
    expect(formatField(f("text", 3), "ABCDEF")).toBe("ABC");
    expect(formatField(f("text", 4), null)).toBe("    ");
  });

  it("doc: só dígitos, alinhado à ESQUERDA + espaços à direita (CNPJ preenche, CPF sobra)", () => {
    // CNPJ (14 díg) preenche o campo inteiro
    expect(formatField(f("doc", 14), "12.345.678/0001-90")).toBe("12345678000190");
    // CPF (11 díg) → 11 dígitos à esquerda + 3 espaços à direita (NÃO zero-à-esquerda)
    expect(formatField(f("doc", 14), "111.222.333-44")).toBe("11122233344   ");
  });

  it("money: reais => centavos, zero à esquerda", () => {
    expect(formatField(f("money", 14), 1234.56)).toBe("00000000123456");
    expect(formatField(f("money", 14), 0)).toBe("00000000000000");
    expect(formatField(f("money", 14), null)).toBe("00000000000000");
    // arredonda corretamente
    expect(formatField(f("money", 10), 10.005)).toBe("0000001001");
  });

  it("date: DDMMYYYY, vazio => zeros", () => {
    expect(formatField(f("date", 8), "2025-03-08")).toBe("08032025");
    expect(formatField(f("date", 8), null)).toBe("00000000");
  });

  it("year: 4 dígitos zero-pad", () => {
    expect(formatField(f("year", 4), 2025)).toBe("2025");
  });

  it("const: literal", () => {
    expect(formatField(f("const", 3, { literal: "R01" }), undefined)).toBe("R01");
  });

  it("reserved: só espaços", () => {
    expect(formatField(f("reserved", 5), "ignora")).toBe("     ");
  });
});

describe("serializeRecord", () => {
  it("R01 produz linha do tamanho total com campos nas posições certas", () => {
    const line = serializeRecord({
      layout: R01_LAYOUT,
      values: {
        cnpjDeclarante: "12.345.678/0001-90",
        anoCalendario: 2025,
        nomeEmpresarial: "Imobiliária Modelo Ltda",
        cpfResponsavel: "111.222.333-44",
        endereco: "Rua Um, 100 - Centro",
        uf: "SP",
        codigoMunicipio: "7107",
      },
    });
    expect(line).toHaveLength(R01_LAYOUT.totalLength);
    expect(sliceField(R01_LAYOUT, line, "tipo")).toBe("R01");
    expect(sliceField(R01_LAYOUT, line, "cnpjDeclarante")).toBe("12345678000190");
    expect(sliceField(R01_LAYOUT, line, "anoCalendario")).toBe("2025");
    expect(sliceField(R01_LAYOUT, line, "nomeEmpresarial").trim()).toBe(
      "IMOBILIARIA MODELO LTDA"
    );
    expect(sliceField(R01_LAYOUT, line, "cpfResponsavel")).toBe("11122233344");
    expect(sliceField(R01_LAYOUT, line, "uf")).toBe("SP");
    expect(sliceField(R01_LAYOUT, line, "codigoMunicipio")).toBe("7107");
  });

  it("R04 grava comprador/vendedor/valores nas posições certas", () => {
    const line = serializeRecord({
      layout: R04_LAYOUT,
      values: {
        cnpjDeclarante: "12345678000190",
        anoCalendario: 2025,
        sequencial: 1,
        cpfCnpjComprador: "111.222.333-44",
        nomeComprador: "Ana Compradora",
        cpfCnpjVendedor: "555.666.777-88",
        nomeVendedor: "Beto Vendedor",
        dataContrato: "2025-06-10",
        valorAlienacao: 500000,
        valorComissao: 30000,
      },
    });
    expect(line).toHaveLength(R04_LAYOUT.totalLength);
    expect(sliceField(R04_LAYOUT, line, "tipo")).toBe("R04");
    expect(sliceField(R04_LAYOUT, line, "cpfCnpjComprador")).toBe("11122233344   ");
    expect(sliceField(R04_LAYOUT, line, "nomeVendedor").trim()).toBe("BETO VENDEDOR");
    expect(sliceField(R04_LAYOUT, line, "dataContrato")).toBe("10062025");
    expect(sliceField(R04_LAYOUT, line, "valorAlienacao")).toBe("00000050000000");
    expect(sliceField(R04_LAYOUT, line, "valorComissao")).toBe("00000003000000");
  });
});

describe("buildDimobFile", () => {
  it("junta registros com CRLF e adiciona CRLF final", () => {
    const file = buildDimobFile([
      { layout: R01_LAYOUT, values: { cnpjDeclarante: "1", anoCalendario: 2025, nomeEmpresarial: "X", cpfResponsavel: "1", uf: "SP", codigoMunicipio: "1" } },
      { layout: R04_LAYOUT, values: { cnpjDeclarante: "1", anoCalendario: 2025, sequencial: 1, cpfCnpjComprador: "1", nomeComprador: "A", cpfCnpjVendedor: "2", nomeVendedor: "B", dataContrato: "2025-01-01", valorAlienacao: 1, valorComissao: 1 } },
    ]);
    const lines = file.split(DIMOB_LINE_SEPARATOR);
    expect(lines[0].startsWith("R01")).toBe(true);
    expect(lines[1].startsWith("R04")).toBe(true);
    expect(file.endsWith(DIMOB_LINE_SEPARATOR)).toBe(true);
  });
});
