import { describe, it, expect } from "vitest";
import { partitionByExclusion } from "../aggregate-sales";
import type { DimobSaleRecord } from "../aggregate-sales";

function rec(dealId: string, recordId: string): DimobSaleRecord {
  return {
    recordId,
    dealId,
    dealTitle: "",
    contractId: "",
    fieldOrigins: {},
    comprador: { nome: "", cpfCnpj: "" },
    vendedor: { nome: "", cpfCnpj: "" },
    dataOperacao: "2026-01-01",
    valorAlienacao: 1,
    valorComissao: 0,
    numeroContrato: null,
    imovel: { endereco: null, cep: null, uf: null, tipoImovel: null },
    commissionSource: "none",
    needsReview: false,
  };
}

describe("partitionByExclusion", () => {
  it("separa todas as linhas de um deal excluído", () => {
    const all = [rec("d1", "d1:0"), rec("d2", "d2:0"), rec("d1", "d1:1")];
    const { records, excluded } = partitionByExclusion(all, new Set(["d1"]));
    expect(records.map((r) => r.dealId)).toEqual(["d2"]);
    expect(excluded.map((r) => r.recordId)).toEqual(["d1:0", "d1:1"]);
  });

  it("set vazio → tudo incluído", () => {
    const { records, excluded } = partitionByExclusion([rec("d1", "d1:0")], new Set());
    expect(records).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it("todos excluídos → records vazio", () => {
    const { records, excluded } = partitionByExclusion(
      [rec("d1", "d1:0"), rec("d2", "d2:0")],
      new Set(["d1", "d2"])
    );
    expect(records).toHaveLength(0);
    expect(excluded).toHaveLength(2);
  });
});
