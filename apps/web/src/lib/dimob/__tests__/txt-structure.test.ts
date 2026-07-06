/**
 * Checagens ESTRUTURAIS do TXT gerado (Fase 1b do plano de validação byte-exato).
 *
 * Prova a CONSISTÊNCIA INTERNA do arquivo — que o writer casa com o `layout.ts`:
 * larguras fixas, contiguidade das posições, CRLF, blocos mensais do R02, colapso
 * por locador, money em centavos e docs com checksum. NÃO prova conformidade com o
 * PGD da RFB (isso é a reconciliação de leiaute + o import no PGD).
 */

import { describe, it, expect } from "vitest";
import { buildDimobRecords } from "../build-file";
import { buildDimobFile, serializeRecord, assertLayoutIntegrity } from "../txt-writer";
import { decodeRecord } from "../decode";
import { DIMOB_LAYOUTS, DIMOB_LINE_SEPARATOR, layoutForLine, type DimobRecordLayout } from "../layout";
import { isValidCpfCnpj } from "@/lib/validators/cnpj";
import type { DimobSalesAggregate, DimobDeclarante, DimobSaleRecord } from "../aggregate-sales";
import type { DimobLeaseRecord, DimobLeaseMonth } from "../aggregate-lease";

// ───────────────────────── fixtures sintéticas ─────────────────────────

const declarante: DimobDeclarante = {
  cnpj: "11222333000181", // CNPJ válido
  nomeEmpresarial: "Imobiliária Modelo Ltda",
  cpfResponsavel: "39053344705", // CPF válido
  endereco: "Rua Um, 100 - Centro",
  uf: "SP",
  codigoMunicipio: "7107",
  municipioNome: "São Paulo",
};

function saleRecord(over: Partial<DimobSaleRecord> = {}): DimobSaleRecord {
  return {
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
    numeroContrato: "12345",
    imovel: { endereco: "Rua Dois, 50", cep: "01001000", uf: "SP", tipoImovel: "urbano" },
    commissionSource: "declarante_match",
    needsReview: false,
    ...over,
  };
}

function months(fill: (m: number) => Partial<DimobLeaseMonth>): DimobLeaseMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({
    rendimento: 0,
    comissao: 0,
    imposto: 0,
    ...fill(i + 1),
  }));
}

function leaseRecord(over: Partial<DimobLeaseRecord> = {}): DimobLeaseRecord {
  const meses = months((m) =>
    m <= 6 ? { rendimento: 3200 + m, comissao: 288, imposto: 68.56 } : {}
  );
  return {
    recordId: "lease:L1:0",
    leaseId: "L1",
    ownerId: "O1",
    locador: { nome: "Locador Silva", cpfCnpj: "39053344705", tipoPessoa: "fisica" },
    locatario: { nome: "Inquilino Souza", cpfCnpj: "11144477735" },
    numeroContrato: "145",
    dataContrato: "2025-03-10",
    meses,
    totalRendimento: meses.reduce((a, m) => a + m.rendimento, 0),
    imovel: { endereco: "Rua A, 100 - Centro", cep: "01001000", uf: "SP", tipoImovel: "urbano" },
    ...over,
  };
}

function baseAgg(records: DimobSaleRecord[] = [saleRecord()]): DimobSalesAggregate {
  return { year: 2025, declarante, records, excluded: [], dispensado: false };
}

/** Localiza a fatia de um campo numa linha, pelo layout. */
function slice(line: string, layout: DimobRecordLayout, key: string): string {
  const f = layout.fields.find((x) => x.key === key);
  if (!f) throw new Error(`campo ${key} não existe em ${layout.record}`);
  return line.slice(f.start - 1, f.start - 1 + f.length);
}

// ───────────────────────── testes ─────────────────────────

describe("integridade dos layouts (geometria)", () => {
  for (const rec of ["R01", "R02", "R04"] as const) {
    it(`${rec}: campos contíguos e totalLength coerente`, () => {
      expect(() => assertLayoutIntegrity(DIMOB_LAYOUTS[rec])).not.toThrow();
    });
  }
});

describe("estrutura do TXT emitido", () => {
  const inputs = buildDimobRecords(baseAgg(), [leaseRecord()]);
  const txt = buildDimobFile(inputs);
  const lines = txt.split(DIMOB_LINE_SEPARATOR).filter(Boolean);

  it("termina cada registro com CRLF e tem CRLF final", () => {
    expect(txt.endsWith(DIMOB_LINE_SEPARATOR)).toBe(true);
    expect(txt.includes("\r\n")).toBe(true);
    // sem LF solto (sempre CRLF)
    expect(txt.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("cada linha tem exatamente o totalLength do seu registro", () => {
    for (const line of lines) {
      const layout = layoutForLine(line);
      expect(layout).toBeDefined();
      expect(line.length).toBe(layout!.totalLength);
    }
  });

  it("round-trip: decodeRecord(raw) == linha serializada (sem gap/overlap)", () => {
    for (const input of inputs) {
      const line = serializeRecord(input);
      expect(decodeRecord(input.layout, input.values).raw).toBe(line);
    }
  });

  it("envolve com header DIMOB (374) + trailer T9 (102) na ordem esperada", () => {
    expect(lines[0].startsWith("DIMOB")).toBe(true);
    expect(lines[0].length).toBe(374);
    expect(lines[1].startsWith("R01")).toBe(true);
    expect(lines[2].startsWith("R04")).toBe(true);
    expect(lines[3].startsWith("R02")).toBe(true);
    expect(lines[lines.length - 1].startsWith("T9")).toBe(true);
    expect(lines[lines.length - 1].length).toBe(102);
  });
});

describe("R02 — blocos mensais e money", () => {
  const inputs = buildDimobRecords(baseAgg([]), [leaseRecord()]);
  const r02 = buildDimobFile(inputs).split(DIMOB_LINE_SEPARATOR).filter(Boolean).find((l) => l.startsWith("R02"))!;
  const L = DIMOB_LAYOUTS.R02;

  it("12 tripletos {aluguel,comissão,imposto} de 14 dígitos numéricos", () => {
    for (let m = 1; m <= 12; m++) {
      for (const prefix of ["aluguel", "comissao", "imposto"]) {
        const s = slice(r02, L, `${prefix}_${m}`);
        expect(s.length).toBe(14);
        expect(s).toMatch(/^\d{14}$/); // numérico, zero à esquerda
      }
    }
  });

  it("money grava em centavos (aluguel mês 1 = 3201,00 → ...320100)", () => {
    // fixture: mês 1 rendimento = 3200 + 1 = 3201 reais → 320100 centavos
    expect(slice(r02, L, "aluguel_1")).toBe("00000000320100");
  });

  it("IRRF do mês 1 = 68,56 → ...6856 centavos", () => {
    expect(slice(r02, L, "imposto_1")).toBe("00000000006856");
  });

  it("meses sem pagamento ficam zerados", () => {
    expect(slice(r02, L, "aluguel_12")).toBe("00000000000000");
  });

  it("doc do locador: CPF de 11 díg alinhado à esquerda + 3 espaços (não zero-à-esq)", () => {
    expect(slice(r02, L, "cpfCnpjLocador")).toBe("39053344705   ");
    expect(isValidCpfCnpj("39053344705")).toBe(true);
  });
});

describe("R02 — colapso por locador (2 contratos do mesmo locador somam)", () => {
  it("aluguel do mês 1 na linha == soma dos dois lease-records", () => {
    const a = leaseRecord({ recordId: "lease:L1:0", leaseId: "L1" });
    const b = leaseRecord({ recordId: "lease:L2:0", leaseId: "L2", numeroContrato: "200", dataContrato: "2024-01-01" });
    const inputs = buildDimobRecords(baseAgg([]), [a, b]);
    const linhas = buildDimobFile(inputs).split(DIMOB_LINE_SEPARATOR).filter(Boolean).filter((l) => l.startsWith("R02"));
    // mesmo locador (mesmo CPF) → colapsa em UMA linha R02
    expect(linhas).toHaveLength(1);
    const centavos = Number(slice(linhas[0], DIMOB_LAYOUTS.R02, "aluguel_1"));
    // 3201 + 3201 = 6402 reais → 640200 centavos
    expect(centavos).toBe(640200);
  });

  it("locadores distintos geram linhas R02 separadas", () => {
    const a = leaseRecord({ ownerId: "O1", locador: { nome: "A", cpfCnpj: "39053344705", tipoPessoa: "fisica" } });
    const b = leaseRecord({
      recordId: "lease:L1:1",
      ownerId: "O2",
      locador: { nome: "B", cpfCnpj: "11144477735", tipoPessoa: "fisica" },
    });
    const inputs = buildDimobRecords(baseAgg([]), [a, b]);
    const linhas = buildDimobFile(inputs).split(DIMOB_LINE_SEPARATOR).filter(Boolean).filter((l) => l.startsWith("R02"));
    expect(linhas).toHaveLength(2);
  });
});

describe("R01 — retificadora", () => {
  const r01Line = (opts = {}) =>
    buildDimobFile(buildDimobRecords(baseAgg(), [], opts))
      .split(DIMOB_LINE_SEPARATOR)
      .filter(Boolean)
      .find((l) => l.startsWith("R01"))!;

  it("normal: indicador 0, recibo zerado", () => {
    const line = r01Line();
    expect(slice(line, DIMOB_LAYOUTS.R01, "retificadora")).toBe("0");
    expect(slice(line, DIMOB_LAYOUTS.R01, "numeroRecibo")).toBe("0000000000");
  });

  it("retificadora: indicador 1 + nº do recibo à direita", () => {
    const line = r01Line({ retificadora: true, numeroRecibo: "12345678901" });
    expect(slice(line, DIMOB_LAYOUTS.R01, "retificadora")).toBe("1");
    expect(slice(line, DIMOB_LAYOUTS.R01, "numeroRecibo")).toBe("2345678901"); // 10 díg, trunca à esquerda
  });
});

describe("R04 — venda (à vista e financiamento cobrem os mesmos campos)", () => {
  it("valor da alienação e comissão em centavos", () => {
    const line = buildDimobFile(buildDimobRecords(baseAgg([saleRecord()]))).split(DIMOB_LINE_SEPARATOR).filter(Boolean).find((l) => l.startsWith("R04"))!;
    expect(Number(slice(line, DIMOB_LAYOUTS.R04, "valorAlienacao"))).toBe(50000000); // 500000,00
    expect(Number(slice(line, DIMOB_LAYOUTS.R04, "valorComissao"))).toBe(3000000); // 30000,00
    expect(slice(line, DIMOB_LAYOUTS.R04, "cpfCnpjComprador")).toBe("39053344705   ");
  });
});
