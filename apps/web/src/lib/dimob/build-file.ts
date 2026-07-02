/**
 * Monta o arquivo TXT da DIMOB a partir do agregado de vendas:
 * declarante → 1 registro R01; cada operação → 1 registro R04.
 *
 * Toda a geometria vem de layout.ts (via txt-writer); aqui só mapeamos os
 * valores lógicos do agregado para as chaves dos campos.
 */

import { createHash } from "crypto";
import { R01_LAYOUT, R02_LAYOUT, R04_LAYOUT } from "./layout";
import { buildDimobFile, type DimobRecordInput, type DimobValue } from "./txt-writer";
import type {
  DimobSalesAggregate,
  DimobDeclarante,
  DimobSaleRecord,
} from "./aggregate-sales";
import type { DimobLeaseRecord, DimobLeaseMonth } from "./aggregate-lease";

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Registro R02 consolidado por locador. */
export interface OwnerR02 {
  ownerId: string;
  locador: { nome: string; cpfCnpj: string; tipoPessoa: string };
  locatario: { nome: string; cpfCnpj: string };
  numeroContrato: string | null;
  dataContrato: string | null;
  meses: DimobLeaseMonth[];
  imovel: { endereco: string | null; cep: string | null; uf: string | null; tipoImovel: "urbano" | "rural" | null };
}

/**
 * Colapsa os lease-records (por lease×locador) em UMA linha R02 por LOCADOR
 * (FAQ p71/72): soma os 12 meses de todos os contratos do locador; referência =
 * contrato mais antigo (dataContrato).
 */
export function groupLeaseRecordsByOwner(records: DimobLeaseRecord[]): OwnerR02[] {
  const byOwner = new Map<string, DimobLeaseRecord[]>();
  for (const r of records) {
    const list = byOwner.get(r.ownerId);
    if (list) list.push(r);
    else byOwner.set(r.ownerId, [r]);
  }
  return [...byOwner.values()].map((recs) => {
    const ref = [...recs].sort((a, b) =>
      (a.dataContrato ?? "9999-99-99").localeCompare(b.dataContrato ?? "9999-99-99")
    )[0];
    const meses: DimobLeaseMonth[] = Array.from({ length: 12 }, (_, m) => ({
      rendimento: round2(recs.reduce((a, r) => a + r.meses[m].rendimento, 0)),
      comissao: round2(recs.reduce((a, r) => a + r.meses[m].comissao, 0)),
      imposto: round2(recs.reduce((a, r) => a + r.meses[m].imposto, 0)),
    }));
    return {
      ownerId: ref.ownerId,
      locador: ref.locador,
      locatario: ref.locatario,
      numeroContrato: ref.numeroContrato,
      dataContrato: ref.dataContrato,
      meses,
      imovel: ref.imovel,
    };
  });
}

/** Valores lógicos de um registro R02 (locação, por locador). */
export function leaseRecordValues(
  declarante: DimobDeclarante,
  year: number,
  o: OwnerR02,
  sequencial: number
): Record<string, DimobValue> {
  const values: Record<string, DimobValue> = {
    cnpjDeclarante: declarante.cnpj,
    anoCalendario: year,
    sequencial,
    cpfCnpjLocador: o.locador.cpfCnpj,
    nomeLocador: o.locador.nome,
    cpfCnpjLocatario: o.locatario.cpfCnpj,
    nomeLocatario: o.locatario.nome,
    numeroContrato: o.numeroContrato ?? "",
    dataContrato: o.dataContrato ?? "",
    tipoImovel: tipoImovelCode(o.imovel.tipoImovel),
    enderecoImovel: o.imovel.endereco ?? "",
    cepImovel: o.imovel.cep ?? "",
    ufImovel: o.imovel.uf ?? "",
  };
  o.meses.forEach((mes, idx) => {
    const m = idx + 1;
    values[`aluguel_${m}`] = mes.rendimento;
    values[`comissao_${m}`] = mes.comissao;
    values[`imposto_${m}`] = mes.imposto;
  });
  return values;
}

/** Mapeia os agregados para os registros posicionais (R01 + R04 vendas + R02 locação). */
export function buildDimobRecords(
  agg: DimobSalesAggregate,
  leaseRecords: DimobLeaseRecord[] = []
): DimobRecordInput[] {
  const { declarante, year } = agg;
  const records: DimobRecordInput[] = [
    { layout: R01_LAYOUT, values: declaranteValues(declarante, year) },
  ];
  agg.records.forEach((r, i) => {
    records.push({ layout: R04_LAYOUT, values: saleRecordValues(declarante, year, r, i + 1) });
  });
  groupLeaseRecordsByOwner(leaseRecords).forEach((o, i) => {
    records.push({ layout: R02_LAYOUT, values: leaseRecordValues(declarante, year, o, i + 1) });
  });
  return records;
}

export function buildDimobFileFromAggregate(
  agg: DimobSalesAggregate,
  leaseRecords: DimobLeaseRecord[] = []
): DimobBuildResult {
  const records = buildDimobRecords(agg, leaseRecords);
  const txt = buildDimobFile(records);
  const totalLocacao = leaseRecords.reduce((a, r) => a + r.totalRendimento, 0);
  return {
    txt,
    recordCount: records.length,
    totalOperacoes: round2(
      agg.records.reduce((a, r) => a + r.valorAlienacao, 0) + totalLocacao
    ),
    totalComissao: round2(
      agg.records.reduce((a, r) => a + r.valorComissao, 0) +
        leaseRecords.reduce((a, r) => a + r.meses.reduce((s, m) => s + m.comissao, 0), 0)
    ),
    contentHash: createHash("sha256").update(txt, "utf8").digest("hex"),
  };
}
