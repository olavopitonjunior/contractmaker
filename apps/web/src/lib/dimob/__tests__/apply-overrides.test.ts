import { describe, it, expect } from "vitest";
import { applyOverrides } from "../apply-overrides";
import type {
  DimobSalesAggregate,
  DimobSaleRecord,
  DimobDeclarante,
} from "../aggregate-sales";

const declarante: DimobDeclarante = {
  cnpj: "",
  nomeEmpresarial: "",
  cpfResponsavel: "",
  endereco: "",
  uf: "",
  codigoMunicipio: "",
  municipioNome: null,
};

const rec: DimobSaleRecord = {
  recordId: "d1:0",
  dealId: "d1",
  dealTitle: "Venda",
  contractId: "c1",
  fieldOrigins: {},
  comprador: { nome: "Ana", cpfCnpj: "" },
  vendedor: { nome: "Beto", cpfCnpj: "11144477735" },
  dataOperacao: "2025-06-10",
  valorAlienacao: 500000,
  valorComissao: 30000,
  numeroContrato: null,
  imovel: { endereco: null, cep: null, uf: null, tipoImovel: null },
  commissionSource: "declarante_match",
  needsReview: false,
};

const base: DimobSalesAggregate = {
  year: 2025,
  declarante,
  records: [rec],
  excluded: [],
  dispensado: false,
};

describe("applyOverrides", () => {
  it("estado vazio devolve o agregado sem alterar", () => {
    expect(applyOverrides(base, {})).toBe(base);
    expect(applyOverrides(base, null)).toBe(base);
  });

  it("override do declarante remove máscara de CNPJ/CPF e maiusculiza UF", () => {
    const out = applyOverrides(base, {
      declarante: {
        cnpjDeclarante: "11.222.333/0001-81",
        cpfResponsavel: "390.533.447-05",
        uf: "sp",
        codigoMunicipio: "7107",
      },
    });
    expect(out.declarante.cnpj).toBe("11222333000181");
    expect(out.declarante.cpfResponsavel).toBe("39053344705");
    expect(out.declarante.uf).toBe("SP");
    expect(out.declarante.codigoMunicipio).toBe("7107");
  });

  it("override de operação coage valor para número e doc para dígitos", () => {
    const out = applyOverrides(base, {
      "d1:0": {
        cpfCnpjComprador: "390.533.447-05",
        valorAlienacao: "1.234.567,89",
        nomeComprador: "Ana Maria",
      },
    });
    const r = out.records[0];
    expect(r.comprador.cpfCnpj).toBe("39053344705");
    expect(r.comprador.nome).toBe("Ana Maria");
    expect(r.valorAlienacao).toBeCloseTo(1234567.89, 2);
    // campos não editados permanecem
    expect(r.vendedor.nome).toBe("Beto");
  });

  it("recordId desconhecido é ignorado", () => {
    const out = applyOverrides(base, { "zzz:9": { nomeComprador: "X" } });
    expect(out.records[0].comprador.nome).toBe("Ana");
  });
});
