/**
 * Monta o arquivo TXT da DIMOB a partir do agregado de vendas:
 * declarante → 1 registro R01; cada operação → 1 registro R04.
 *
 * Toda a geometria vem de layout.ts (via txt-writer); aqui só mapeamos os
 * valores lógicos do agregado para as chaves dos campos.
 */

import { createHash } from "crypto";
import { R01_LAYOUT, R04_LAYOUT } from "./layout";
import { buildDimobFile, type DimobRecordInput, type DimobValue } from "./txt-writer";
import type {
  DimobSalesAggregate,
  DimobDeclarante,
  DimobSaleRecord,
} from "./aggregate-sales";

export interface DimobBuildResult {
  txt: string;
  recordCount: number;
  totalOperacoes: number;
  totalComissao: number;
  contentHash: string;
}

function tipoImovelCode(tipo: "urbano" | "rural" | null): string {
  if (tipo === "urbano") return "1";
  if (tipo === "rural") return "2";
  return "";
}

/** Valores lógicos do registro R01 (declarante). */
export function declaranteValues(
  declarante: DimobDeclarante,
  year: number
): Record<string, DimobValue> {
  return {
    cnpjDeclarante: declarante.cnpj,
    anoCalendario: year,
    nomeEmpresarial: declarante.nomeEmpresarial,
    cpfResponsavel: declarante.cpfResponsavel,
    endereco: declarante.endereco,
    uf: declarante.uf,
    codigoMunicipio: declarante.codigoMunicipio,
  };
}

/** Valores lógicos de um registro R04 (operação de venda). */
export function saleRecordValues(
  declarante: DimobDeclarante,
  year: number,
  r: DimobSaleRecord,
  sequencial: number
): Record<string, DimobValue> {
  return {
    cnpjDeclarante: declarante.cnpj,
    anoCalendario: year,
    sequencial,
    cpfCnpjComprador: r.comprador.cpfCnpj,
    nomeComprador: r.comprador.nome,
    cpfCnpjVendedor: r.vendedor.cpfCnpj,
    nomeVendedor: r.vendedor.nome,
    numeroContrato: r.numeroContrato ?? "",
    dataContrato: r.dataOperacao,
    valorAlienacao: r.valorAlienacao,
    valorComissao: r.valorComissao,
    tipoImovel: tipoImovelCode(r.imovel.tipoImovel),
    enderecoImovel: r.imovel.endereco ?? "",
    cepImovel: r.imovel.cep ?? "",
    ufImovel: r.imovel.uf ?? "",
  };
}

/** Mapeia o agregado para os registros posicionais (R01 + R04...). */
export function buildDimobRecords(agg: DimobSalesAggregate): DimobRecordInput[] {
  const { declarante, year } = agg;
  const records: DimobRecordInput[] = [
    { layout: R01_LAYOUT, values: declaranteValues(declarante, year) },
  ];
  agg.records.forEach((r, i) => {
    records.push({ layout: R04_LAYOUT, values: saleRecordValues(declarante, year, r, i + 1) });
  });
  return records;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildDimobFileFromAggregate(agg: DimobSalesAggregate): DimobBuildResult {
  const records = buildDimobRecords(agg);
  const txt = buildDimobFile(records);
  return {
    txt,
    recordCount: records.length,
    totalOperacoes: round2(agg.records.reduce((a, r) => a + r.valorAlienacao, 0)),
    totalComissao: round2(agg.records.reduce((a, r) => a + r.valorComissao, 0)),
    contentHash: createHash("sha256").update(txt, "utf8").digest("hex"),
  };
}
