import { describe, it, expect } from "vitest";
import { resolveDeclarantCommission } from "../aggregate-sales";
import type {
  DimobSalesAggregate,
  DimobSaleRecord,
  DimobDeclarante,
} from "../aggregate-sales";
import type { DadosContratoLite } from "@/lib/asaas/commission";
import {
  validateDeclarante,
  validateRecord,
  validateAggregate,
  hasBlockingErrors,
} from "../validate";
import { buildDimobFileFromAggregate, buildDimobRecords } from "../build-file";
import { DIMOB_LINE_SEPARATOR } from "../layout";

const ORG_CNPJ = "11222333000181"; // CNPJ válido (checksum)

function data(partial: Record<string, unknown>): DadosContratoLite {
  return partial as unknown as DadosContratoLite;
}

describe("resolveDeclarantCommission", () => {
  it("casa o CNPJ da org entre os comissionados (fatia do declarante)", () => {
    const d = data({
      pagamento: { valor_total: 500000 },
      comissao: {
        comissionados: [
          { cnpj: "11.222.333/0001-81", papel: "imobiliaria_principal", valor: 18000 },
          { cnpj: "99999999000199", papel: "captador", valor: 12000 },
        ],
      },
    });
    const r = resolveDeclarantCommission(d, ORG_CNPJ);
    expect(r.source).toBe("declarante_match");
    expect(r.value).toBe(18000);
  });

  it("sem match, usa o comissionado principal", () => {
    const d = data({
      pagamento: { valor_total: 500000 },
      comissao: {
        comissionados: [
          { cnpj: "99999999000199", papel: "imobiliaria_principal", percentual: 6 },
        ],
      },
    });
    const r = resolveDeclarantCommission(d, ORG_CNPJ);
    expect(r.source).toBe("principal");
    expect(r.value).toBe(30000); // 6% de 500000
  });

  it("sem comissionados, cai no total declarado (fallback)", () => {
    const d = data({ pagamento: { valor_total: 500000 }, comissao: { valor: 25000 } });
    const r = resolveDeclarantCommission(d, ORG_CNPJ);
    expect(r.source).toBe("total_fallback");
    expect(r.value).toBe(25000);
  });

  it("sem qualquer comissão → none/0", () => {
    const d = data({ pagamento: { valor_total: 500000 }, comissao: {} });
    const r = resolveDeclarantCommission(d, ORG_CNPJ);
    expect(r.source).toBe("none");
    expect(r.value).toBe(0);
  });
});

const goodDeclarante: DimobDeclarante = {
  cnpj: ORG_CNPJ,
  nomeEmpresarial: "Imobiliária Modelo Ltda",
  cpfResponsavel: "39053344705", // CPF válido
  endereco: "Rua Um, 100",
  uf: "SP",
  codigoMunicipio: "7107",
  municipioNome: "São Paulo",
};

const goodRecord: DimobSaleRecord = {
  recordId: "d1:0",
  dealId: "d1",
  dealTitle: "Venda 1",
  contractId: "c1",
  fieldOrigins: {},
  comprador: { nome: "Ana Compradora", cpfCnpj: "39053344705" },
  vendedor: { nome: "Beto Vendedor", cpfCnpj: "11144477735" },
  dataOperacao: "2025-06-10",
  valorAlienacao: 500000,
  valorComissao: 30000,
  numeroContrato: null,
  imovel: { endereco: "Rua Dois, 50", cep: "01001000", uf: "SP", tipoImovel: null },
  commissionSource: "declarante_match",
  needsReview: false,
};

describe("validate", () => {
  it("declarante completo não gera erro", () => {
    expect(validateDeclarante(goodDeclarante)).toHaveLength(0);
  });

  it("declarante sem CNPJ/CPF responsável/UF/município gera erros", () => {
    const bad: DimobDeclarante = {
      cnpj: "",
      nomeEmpresarial: "",
      cpfResponsavel: "",
      endereco: "",
      uf: "",
      codigoMunicipio: "",
      municipioNome: null,
    };
    const issues = validateDeclarante(bad);
    expect(issues.every((i) => i.level === "error")).toBe(true);
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(["cnpj", "nomeEmpresarial", "cpfResponsavel", "uf", "codigoMunicipio"])
    );
  });

  it("registro com CPF de comprador inválido bloqueia", () => {
    const bad = { ...goodRecord, comprador: { nome: "X", cpfCnpj: "111" } };
    const issues = validateRecord(bad);
    expect(issues.some((i) => i.field === "cpfCnpjComprador" && i.level === "error")).toBe(true);
  });

  it("fallback de comissão vira warning (não bloqueia)", () => {
    const rec = { ...goodRecord, commissionSource: "total_fallback" as const };
    const issues = validateRecord(rec);
    expect(issues.some((i) => i.level === "warning" && i.field === "valorComissao")).toBe(true);
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it("número/data do contrato ausentes não bloqueiam", () => {
    expect(validateRecord(goodRecord)).toHaveLength(0);
  });
});

describe("build-file", () => {
  const agg: DimobSalesAggregate = {
    year: 2025,
    declarante: goodDeclarante,
    records: [goodRecord],
    dispensado: false,
  };

  it("gera R01 + R04 com totais e hash", () => {
    const out = buildDimobFileFromAggregate(agg);
    expect(out.recordCount).toBe(2);
    expect(out.totalOperacoes).toBe(500000);
    expect(out.totalComissao).toBe(30000);
    expect(out.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const lines = out.txt.split(DIMOB_LINE_SEPARATOR).filter(Boolean);
    expect(lines[0].startsWith("R01")).toBe(true);
    expect(lines[1].startsWith("R04")).toBe(true);
    expect(lines[0]).toContain("IMOBILIARIA MODELO LTDA");
    expect(lines[1]).toContain("ANA COMPRADORA");
  });

  it("agregado sem operações gera só R01 (dispensa é sinalizada à parte)", () => {
    const empty = { ...agg, records: [], dispensado: true };
    const recs = buildDimobRecords(empty);
    expect(recs).toHaveLength(1);
    expect(recs[0].layout.record).toBe("R01");
  });

  it("hash é estável para o mesmo agregado", () => {
    expect(buildDimobFileFromAggregate(agg).contentHash).toBe(
      buildDimobFileFromAggregate(agg).contentHash
    );
  });
});
