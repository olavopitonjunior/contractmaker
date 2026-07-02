import { describe, it, expect } from "vitest";
import {
  buildDimobFileFromAggregate,
  buildDimobRecords,
  groupLeaseRecordsByOwner,
} from "../build-file";
import { validateLeaseRecord } from "../validate";
import type { DimobSalesAggregate, DimobDeclarante } from "../aggregate-sales";
import type { DimobLeaseRecord, DimobLeaseMonth } from "../aggregate-lease";
import { DIMOB_LINE_SEPARATOR, R02_LAYOUT } from "../layout";

const declarante: DimobDeclarante = {
  cnpj: "11222333000181",
  nomeEmpresarial: "Imobiliária Modelo Ltda",
  cpfResponsavel: "39053344705",
  endereco: "Rua Um, 100",
  uf: "SP",
  codigoMunicipio: "7107",
  municipioNome: "São Paulo",
};

const emptyAgg: DimobSalesAggregate = {
  year: 2026,
  declarante,
  records: [],
  excluded: [],
  dispensado: true,
};

function meses(fill: Partial<DimobLeaseMonth> = {}): DimobLeaseMonth[] {
  return Array.from({ length: 12 }, () => ({ rendimento: 0, comissao: 0, imposto: 0, ...fill }));
}

function leaseRecord(over: Partial<DimobLeaseRecord> = {}): DimobLeaseRecord {
  const m = meses();
  m[0] = { rendimento: 3200, comissao: 300, imposto: 68.56 };
  return {
    recordId: "lease:L1:0",
    leaseId: "L1",
    ownerId: "O1",
    locador: { nome: "Locador PF", cpfCnpj: "39053344705", tipoPessoa: "fisica" },
    locatario: { nome: "Inquilino", cpfCnpj: "11144477735" },
    numeroContrato: "145",
    dataContrato: "2025-03-10",
    meses: m,
    totalRendimento: 3200,
    imovel: { endereco: "Rua A, 100 - Centro", cep: "01001000", uf: "SP", tipoImovel: "urbano" },
    ...over,
  };
}

describe("groupLeaseRecordsByOwner", () => {
  it("colapsa vários contratos do mesmo locador somando os 12 meses (contrato mais antigo como ref)", () => {
    const a = leaseRecord({ recordId: "lease:L1:0", leaseId: "L1", dataContrato: "2025-03-10" });
    const b = leaseRecord({
      recordId: "lease:L2:0",
      leaseId: "L2",
      dataContrato: "2024-01-01",
      numeroContrato: "200",
    });
    const owners = groupLeaseRecordsByOwner([a, b]);
    expect(owners).toHaveLength(1);
    expect(owners[0].meses[0].rendimento).toBeCloseTo(6400, 2); // 3200 + 3200
    expect(owners[0].numeroContrato).toBe("200"); // contrato mais antigo
  });

  it("locadores distintos geram linhas separadas", () => {
    const a = leaseRecord({ ownerId: "O1" });
    const b = leaseRecord({ recordId: "lease:L1:1", ownerId: "O2", locador: { nome: "B", cpfCnpj: "11144477735", tipoPessoa: "fisica" } });
    expect(groupLeaseRecordsByOwner([a, b])).toHaveLength(2);
  });
});

describe("build-file com R02", () => {
  it("emite R01 + R02, com a linha R02 na largura do layout", () => {
    const out = buildDimobFileFromAggregate(emptyAgg, [leaseRecord()]);
    const lines = out.txt.split(DIMOB_LINE_SEPARATOR).filter(Boolean);
    expect(lines[0].startsWith("R01")).toBe(true);
    expect(lines[1].startsWith("R02")).toBe(true);
    expect(lines[1].length).toBe(R02_LAYOUT.totalLength);
    expect(lines[1]).toContain("LOCADOR PF");
  });

  it("totais incluem comissão da locação", () => {
    const out = buildDimobFileFromAggregate(emptyAgg, [leaseRecord()]);
    expect(out.totalComissao).toBeCloseTo(300, 2);
    expect(out.recordCount).toBe(2); // R01 + 1 R02
  });

  it("buildDimobRecords sem leaseRecords não emite R02", () => {
    expect(buildDimobRecords(emptyAgg)).toHaveLength(1);
  });
});

describe("validateLeaseRecord", () => {
  it("locador sem CPF/CNPJ válido bloqueia (error)", () => {
    const bad = leaseRecord({ locador: { nome: "X", cpfCnpj: "111", tipoPessoa: "fisica" } });
    const issues = validateLeaseRecord(bad);
    expect(issues.some((i) => i.field === "cpfCnpjLocador" && i.level === "error")).toBe(true);
    expect(issues.every((i) => i.scope === "locacao")).toBe(true);
    expect(issues[0].leaseId).toBe("L1");
  });

  it("registro válido não gera erro", () => {
    expect(validateLeaseRecord(leaseRecord())).toHaveLength(0);
  });
});
