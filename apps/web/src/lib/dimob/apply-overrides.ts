/**
 * Aplica as edições do usuário (overrides) sobre o agregado ANTES de validar e
 * serializar. Garante que "o que se vê na grade = o que se gera no TXT".
 *
 * O estado de override é `{ [recordId]: { [fieldKey]: valorString } }` onde
 * recordId = "declarante" (R01) ou "{dealId}:{idx}" (R04). As chaves são as do
 * layout; aqui mapeamos de volta para os campos do agregado, coagindo tipos.
 * Puro e testável.
 */

import type {
  DimobSalesAggregate,
  DimobDeclarante,
  DimobSaleRecord,
} from "./aggregate-sales";

export type DimobFieldOverrides = Record<string, string>;
export type DimobOverrideState = Record<string, DimobFieldOverrides>;

const digits = (s: string) => (s ?? "").replace(/\D/g, "");

function toNum(s: string): number {
  const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function applyDeclarante(dec: DimobDeclarante, ov: DimobFieldOverrides): DimobDeclarante {
  return {
    ...dec,
    cnpj: ov.cnpjDeclarante !== undefined ? digits(ov.cnpjDeclarante) : dec.cnpj,
    nomeEmpresarial: ov.nomeEmpresarial ?? dec.nomeEmpresarial,
    cpfResponsavel: ov.cpfResponsavel !== undefined ? digits(ov.cpfResponsavel) : dec.cpfResponsavel,
    endereco: ov.endereco ?? dec.endereco,
    uf: ov.uf !== undefined ? ov.uf.trim().toUpperCase() : dec.uf,
    codigoMunicipio: ov.codigoMunicipio !== undefined ? digits(ov.codigoMunicipio) : dec.codigoMunicipio,
  };
}

function applyRecord(rec: DimobSaleRecord, ov: DimobFieldOverrides): DimobSaleRecord {
  const r: DimobSaleRecord = {
    ...rec,
    comprador: { ...rec.comprador },
    vendedor: { ...rec.vendedor },
    imovel: { ...rec.imovel },
  };
  if (ov.cpfCnpjComprador !== undefined) r.comprador.cpfCnpj = digits(ov.cpfCnpjComprador);
  if (ov.nomeComprador !== undefined) r.comprador.nome = ov.nomeComprador;
  if (ov.cpfCnpjVendedor !== undefined) r.vendedor.cpfCnpj = digits(ov.cpfCnpjVendedor);
  if (ov.nomeVendedor !== undefined) r.vendedor.nome = ov.nomeVendedor;
  if (ov.dataContrato !== undefined) r.dataOperacao = ov.dataContrato;
  if (ov.valorAlienacao !== undefined) r.valorAlienacao = toNum(ov.valorAlienacao);
  if (ov.valorComissao !== undefined) r.valorComissao = toNum(ov.valorComissao);
  if (ov.numeroContrato !== undefined) r.numeroContrato = digits(ov.numeroContrato) || null;
  if (ov.enderecoImovel !== undefined) r.imovel.endereco = ov.enderecoImovel || null;
  if (ov.cepImovel !== undefined) r.imovel.cep = digits(ov.cepImovel) || null;
  if (ov.ufImovel !== undefined) r.imovel.uf = ov.ufImovel.trim().toUpperCase() || null;
  return r;
}

export function applyOverrides(
  agg: DimobSalesAggregate,
  state: DimobOverrideState | null | undefined
): DimobSalesAggregate {
  if (!state || Object.keys(state).length === 0) return agg;

  const declarante = state.declarante
    ? applyDeclarante(agg.declarante, state.declarante)
    : agg.declarante;

  const records = agg.records.map((r) =>
    state[r.recordId] ? applyRecord(r, state[r.recordId]) : r
  );

  return { ...agg, declarante, records };
}
