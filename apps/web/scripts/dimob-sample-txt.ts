/**
 * Gera TXTs-amostra da DIMOB a partir de dados SINTÉTICOS (sem banco), cobrindo os
 * casos que estressam o leiaute (R01+R04+R02, colapso por locador, PF-IRRF, PJ-sem-
 * IRRF, retificadora). Serve para (a) inspeção visual com régua de colunas e (b)
 * produzir um arquivo importável no PGD DIMOB para o aceite byte-exato.
 *
 * Uso: pnpm tsx apps/web/scripts/dimob-sample-txt.ts [--out <dir>]
 * Não toca em banco nem rede.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildDimobRecords, buildDimobFileFromAggregate } from "../src/lib/dimob/build-file";
import { serializeRecord } from "../src/lib/dimob/txt-writer";
import { buildColumnRuler } from "../src/lib/dimob/decode";
import { DIMOB_LAYOUT_VERSION } from "../src/lib/dimob/layout";
import type { DimobSalesAggregate, DimobDeclarante, DimobSaleRecord } from "../src/lib/dimob/aggregate-sales";
import type { DimobLeaseRecord, DimobLeaseMonth } from "../src/lib/dimob/aggregate-lease";

const declarante: DimobDeclarante = {
  cnpj: "11222333000181",
  nomeEmpresarial: "Imobiliária Modelo Ltda",
  cpfResponsavel: "39053344705",
  endereco: "Avenida Paulista, 1000, Bela Vista, Sao Paulo/SP",
  uf: "SP",
  codigoMunicipio: "7107",
  municipioNome: "São Paulo",
};

function sale(over: Partial<DimobSaleRecord>): DimobSaleRecord {
  return {
    recordId: "d:0",
    dealId: "d",
    dealTitle: "Venda",
    contractId: "c",
    fieldOrigins: {},
    comprador: { nome: "Ana Compradora", cpfCnpj: "39053344705" },
    vendedor: { nome: "Beto Vendedor", cpfCnpj: "11144477735" },
    dataOperacao: "2025-06-10",
    valorAlienacao: 500000,
    valorComissao: 30000,
    numeroContrato: "12345",
    imovel: { endereco: "Rua Dois, 50, Centro", cep: "01001000", uf: "SP", tipoImovel: "urbano" },
    commissionSource: "declarante_match",
    needsReview: false,
    ...over,
  };
}

function meses(fill: (m: number) => Partial<DimobLeaseMonth>): DimobLeaseMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({ rendimento: 0, comissao: 0, imposto: 0, ...fill(i + 1) }));
}

function lease(over: Partial<DimobLeaseRecord>): DimobLeaseRecord {
  const m = meses((mo) => (mo % 3 === 0 ? { rendimento: 3500, comissao: 315, imposto: 82.13 } : {}));
  return {
    recordId: "lease:X:0",
    leaseId: "X",
    ownerId: "O",
    locador: { nome: "Locador Silva", cpfCnpj: "39053344705", tipoPessoa: "fisica" },
    locatario: { nome: "Inquilino Souza", cpfCnpj: "11144477735" },
    numeroContrato: "145",
    dataContrato: "2023-03-10",
    meses: m,
    totalRendimento: m.reduce((a, x) => a + x.rendimento, 0),
    imovel: { endereco: "Rua A, 100, Centro", cep: "01001000", uf: "SP", tipoImovel: "urbano" },
    ...over,
  };
}

const agg: DimobSalesAggregate = {
  year: 2025,
  declarante,
  records: [
    sale({ recordId: "d1:0", dealId: "d1", valorAlienacao: 500000, valorComissao: 30000 }),
    sale({
      recordId: "d2:0",
      dealId: "d2",
      valorAlienacao: 820000.5,
      valorComissao: 41000,
      imovel: { endereco: "Rodovia Rural KM 12", cep: "13480000", uf: "SP", tipoImovel: "rural" },
      numeroContrato: null,
    }),
  ],
  excluded: [],
  dispensado: false,
};

// Locação: 2 contratos do MESMO locador PF (testa colapso) + 1 locador PJ (sem IRRF).
const leaseRecords: DimobLeaseRecord[] = [
  lease({ recordId: "lease:L1:0", leaseId: "L1", ownerId: "O1" }),
  lease({ recordId: "lease:L2:0", leaseId: "L2", ownerId: "O1", numeroContrato: "300", dataContrato: "2021-07-01" }),
  lease({
    recordId: "lease:L3:0",
    leaseId: "L3",
    ownerId: "O2",
    locador: { nome: "Imobiliária Dona LTDA", cpfCnpj: "11222333000181", tipoPessoa: "juridica" },
    meses: meses((mo) => (mo <= 12 ? { rendimento: 5000, comissao: 450, imposto: 0 } : {})),
  }),
];

function dumpRecords(label: string, leaseRecs: DimobLeaseRecord[], opts = {}) {
  const inputs = buildDimobRecords(agg, leaseRecs, opts);
  console.log(`\n===== ${label} (layout ${DIMOB_LAYOUT_VERSION}) =====`);
  for (const input of inputs) {
    const line = serializeRecord(input);
    console.log(`\n[${input.layout.record}] len=${line.length}`);
    console.log(buildColumnRuler(line.length));
    console.log(line);
  }
}

const outDir = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : join(process.cwd(), "dimob-samples");
})();
mkdirSync(outDir, { recursive: true });

// Amostra completa (R01 + 2 R04 + R02 colapsado por locador)
const full = buildDimobFileFromAggregate(agg, leaseRecords);
writeFileSync(join(outDir, "DIMOB_amostra_2025.txt"), full.txt, "latin1");

// Retificadora
const retif = buildDimobFileFromAggregate(agg, leaseRecords, { retificadora: true, numeroRecibo: "12345678901" });
writeFileSync(join(outDir, "DIMOB_amostra_2025_retificadora.txt"), retif.txt, "latin1");

dumpRecords("Amostra completa", leaseRecords);
console.log(
  `\nArquivos: ${join(outDir, "DIMOB_amostra_2025.txt")} (recordCount=${full.recordCount}, ` +
    `totalOperacoes=${full.totalOperacoes}, totalComissao=${full.totalComissao})\n` +
    `         ${join(outDir, "DIMOB_amostra_2025_retificadora.txt")}\n` +
    `Importe o .txt no PGD DIMOB (Declarações → Importar) e rode Validar.`
);
