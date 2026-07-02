import { describe, it, expect } from "vitest";
import { buildReviewRecords } from "../build-review";
import type {
  DimobSalesAggregate,
  DimobSaleRecord,
  DimobDeclarante,
} from "../aggregate-sales";
import { R01_LAYOUT, R04_LAYOUT } from "../layout";

const declaranteOk: DimobDeclarante = {
  cnpj: "11222333000181",
  nomeEmpresarial: "Imobiliária Modelo Ltda",
  cpfResponsavel: "39053344705",
  endereco: "Rua Um, 100",
  uf: "SP",
  codigoMunicipio: "7107",
  municipioNome: "São Paulo",
};

function record(over: Partial<DimobSaleRecord> = {}): DimobSaleRecord {
  return {
    recordId: "d1:0",
    dealId: "d1",
    dealTitle: "Venda 1",
    contractId: "c1",
    fieldOrigins: {
      valorAlienacao: "dataJson.pagamento.valor_total",
      cpfCnpjComprador: "dataJson.compradores[0]",
    },
    comprador: { nome: "Ana Compradora", cpfCnpj: "39053344705" },
    vendedor: { nome: "Beto Vendedor", cpfCnpj: "11144477735" },
    dataOperacao: "2025-06-10",
    valorAlienacao: 500000,
    valorComissao: 30000,
    numeroContrato: null,
    imovel: { endereco: "Rua Dois, 50", cep: "01001000", uf: "SP", tipoImovel: null },
    commissionSource: "declarante_match",
    needsReview: false,
    ...over,
  };
}

function agg(over: Partial<DimobSalesAggregate> = {}): DimobSalesAggregate {
  return { year: 2025, declarante: declaranteOk, records: [record()], dispensado: false, ...over };
}

describe("buildReviewRecords", () => {
  it("retorna R01 primeiro e um R04 por operação", () => {
    const rr = buildReviewRecords(agg({ records: [record(), record({ recordId: "d1:1" })] }));
    expect(rr).toHaveLength(3);
    expect(rr[0].kind).toBe("R01");
    expect(rr[0].recordId).toBe("declarante");
    expect(rr[1].kind).toBe("R04");
  });

  it("raw de cada registro bate com o comprimento do layout", () => {
    const rr = buildReviewRecords(agg());
    expect(rr[0].raw).toHaveLength(R01_LAYOUT.totalLength);
    expect(rr[1].raw).toHaveLength(R04_LAYOUT.totalLength);
  });

  it("declarante sem CNPJ marca a célula cnpjDeclarante como error (via alias)", () => {
    const rr = buildReviewRecords(
      agg({ declarante: { ...declaranteOk, cnpj: "" } })
    );
    const cell = rr[0].cells.find((c) => c.key === "cnpjDeclarante")!;
    expect(cell.status).toBe("error");
    expect(cell.statusMessage).toBeTruthy();
  });

  it("CPF de comprador inválido marca a célula como error", () => {
    const rr = buildReviewRecords(
      agg({ records: [record({ comprador: { nome: "X", cpfCnpj: "111" } })] })
    );
    const cell = rr[1].cells.find((c) => c.key === "cpfCnpjComprador")!;
    expect(cell.status).toBe("error");
  });

  it("célula carrega a origem do campo", () => {
    const rr = buildReviewRecords(agg());
    const cell = rr[1].cells.find((c) => c.key === "valorAlienacao")!;
    expect(cell.origin).toContain("valor_total");
  });

  it("aviso de rateio (multi-parte) cai em recordIssues", () => {
    const rr = buildReviewRecords(agg({ records: [record({ needsReview: true })] }));
    expect(rr[1].recordIssues.some((i) => i.field === "rateio")).toBe(true);
  });
});
