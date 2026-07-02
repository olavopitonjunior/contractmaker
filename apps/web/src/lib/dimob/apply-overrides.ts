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
import type { DimobLeaseRecord } from "./aggregate-lease";

export type DimobFieldOverrides = Record<string, string>;
export type DimobOverrideState = Record<string, DimobFieldOverrides>;

const digits = (s: string) => (s ?? "").replace(/\D/g, "");

function toNum(s: string): number {
  const cleaned = String(s ?? "").replace(/[^0-9.,-]/g, "");
  if (!cleaned) return 0;
  // Com vírgula = formato BR ("1.234,56"): pontos são milhar, vírgula é decimal.
  // Sem vírgula ("68.56" ou "3200"): o ponto é decimal (valor gerado por String(number)).
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Aplica overrides nos registros R02 (locação) por recordId/fieldKey. */
export function applyLeaseOverrides(
  records: DimobLeaseRecord[],
  state: DimobOverrideState | null | undefined
): DimobLeaseRecord[] {
  if (!state || Object.keys(state).length === 0) return records;
  return records.map((r) => {
    const ov = state[r.recordId];
    if (!ov) return r;
    const meses = r.meses.map((mes, idx) => {
      const m = idx + 1;
      return {
        rendimento: ov[`aluguel_${m}`] !== undefined ? toNum(ov[`aluguel_${m}`]) : mes.rendimento,
        comissao: ov[`comissao_${m}`] !== undefined ? toNum(ov[`comissao_${m}`]) : mes.comissao,
        imposto: ov[`imposto_${m}`] !== undefined ? toNum(ov[`imposto_${m}`]) : mes.imposto,
      };
    });
    return {
      ...r,
      locador: {
        ...r.locador,
        nome: ov.nomeLocador ?? r.locador.nome,
        cpfCnpj: ov.cpfCnpjLocador !== undefined ? digits(ov.cpfCnpjLocador) : r.locador.cpfCnpj,
      },
      locatario: {
        ...r.locatario,
        nome: ov.nomeLocatario ?? r.locatario.nome,
        cpfCnpj: ov.cpfCnpjLocatario !== undefined ? digits(ov.cpfCnpjLocatario) : r.locatario.cpfCnpj,
      },
      numeroContrato:
        ov.numeroContrato !== undefined ? digits(ov.numeroContrato) || null : r.numeroContrato,
      dataContrato: ov.dataContrato ?? r.dataContrato,
      imovel: {
        ...r.imovel,
        endereco: ov.enderecoImovel ?? r.imovel.endereco,
        cep: ov.cepImovel !== undefined ? digits(ov.cepImovel) || null : r.imovel.cep,
        uf: ov.ufImovel !== undefined ? ov.ufImovel.trim().toUpperCase() || null : r.imovel.uf,
      },
      meses,
      totalRendimento: round2(meses.reduce((a, x) => a + x.rendimento, 0)),
    };
  });
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
