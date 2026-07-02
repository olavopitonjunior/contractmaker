import { describe, it, expect } from "vitest";
import { decodeRecord, buildColumnRuler } from "../decode";
import { R04_LAYOUT } from "../layout";
import { serializeRecord } from "../txt-writer";

const values = {
  cnpjDeclarante: "11222333000181",
  anoCalendario: 2025,
  sequencial: 1,
  cpfCnpjComprador: "390.533.447-05",
  nomeComprador: "Ana Compradora",
  cpfCnpjVendedor: "111.444.777-35",
  nomeVendedor: "Beto Vendedor",
  dataContrato: "2025-06-10",
  valorAlienacao: 500000,
  valorComissao: 30000,
};

describe("decodeRecord", () => {
  const decoded = decodeRecord(R04_LAYOUT, values);

  it("uma célula por campo do layout", () => {
    expect(decoded.cells).toHaveLength(R04_LAYOUT.fields.length);
    expect(decoded.record).toBe("R04");
    expect(decoded.totalLength).toBe(R04_LAYOUT.totalLength);
  });

  it("a linha bruta reconstruída é idêntica à do serializer", () => {
    expect(decoded.raw).toBe(serializeRecord({ layout: R04_LAYOUT, values }));
    expect(decoded.raw).toHaveLength(R04_LAYOUT.totalLength);
  });

  it("célula de valor traz posição e fatia corretas", () => {
    const cell = decoded.cells.find((c) => c.key === "valorAlienacao")!;
    expect(cell.length).toBe(14);
    expect(cell.end).toBe(cell.start + 13);
    expect(cell.rawSlice).toBe("00000050000000");
    expect(cell.editable).toBe(true);
    // a fatia bruta está na posição declarada
    expect(decoded.raw.slice(cell.start - 1, cell.end)).toBe(cell.rawSlice);
  });

  it("const e reserved não são editáveis", () => {
    expect(decoded.cells.find((c) => c.key === "tipo")!.editable).toBe(false);
    expect(decoded.cells.find((c) => c.type === "reserved")!.editable).toBe(false);
  });

  it("value guarda o valor lógico (editável), não a fatia formatada", () => {
    expect(decoded.cells.find((c) => c.key === "nomeComprador")!.value).toBe("Ana Compradora");
  });
});

describe("buildColumnRuler", () => {
  it("tem o comprimento total e marca a cada 10 posições", () => {
    const ruler = buildColumnRuler(25);
    expect(ruler).toHaveLength(25);
    // "10" termina na posição 10 (índice 9)
    expect(ruler.slice(8, 10)).toBe("10");
    // "20" termina na posição 20 (índice 19)
    expect(ruler.slice(18, 20)).toBe("20");
  });
});
