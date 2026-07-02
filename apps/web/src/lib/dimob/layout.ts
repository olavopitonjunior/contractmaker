/**
 * Leiaute posicional do arquivo TXT da DIMOB (Declaração de Informações sobre
 * Atividades Imobiliárias — IN RFB 1.115/2010).
 *
 * ⚠️ PROVISÓRIO — VALIDAR CONTRA O PGD DIMOB REAL ANTES DE USAR EM PRODUÇÃO.
 *
 * A Receita Federal NÃO publica o leiaute posicional (a FAQ oficial confirma que
 * ele só existe dentro do programa gerador PGD DIMOB). As posições/tamanhos abaixo
 * foram reconstruídas a partir de documentação de ERPs terceiros (Senior, Invent/
 * TaxOne) que reproduzem o layout importável — e essas fontes DIVERGEM no nível de
 * byte. Por isso:
 *
 *   1. Os campos são declarados em ORDEM com o `length`; a posição inicial (`start`)
 *      e o `totalLength` são DERIVADOS (contíguos). Não há offset manual — consertar
 *      o leiaute = reordenar/redimensionar campos aqui, e o writer inteiro segue.
 *   2. Regiões "reservadas" da spec entram como campos `reserved` explícitos (espaço).
 *   3. Antes de considerar "byte-exato", gerar 1 TXT com dados reais e importá-lo no
 *      PGD DIMOB oficial; ajustar os campos conforme os erros do importador.
 *   4. Cobertura v1 = VENDAS: R01 (declarante) e R04 (intermediação de alienação).
 *      R02 (locação) e R03 (construção) ficam para fases seguintes.
 *
 * Convenções de tipo (ver txt-writer.ts):
 *   text   — à esquerda, espaço à direita, MAIÚSCULO, sem acento
 *   num    — à direita, zero à esquerda (só dígitos)
 *   doc    — CPF/CNPJ só dígitos, zero à esquerda (14 pos.)
 *   date   — DDMMYYYY (8 pos.); vazio => zeros
 *   money  — valor em CENTAVOS, zero à esquerda (2 decimais implícitas)
 *   year   — AAAA (4 pos.)
 *   const  — literal fixo (ex.: "R01")
 */

export type DimobFieldType =
  | "text"
  | "num"
  | "doc"
  | "date"
  | "money"
  | "year"
  | "const"
  | "reserved";

/** Especificação declarativa de um campo (sem posição — ela é derivada). */
export interface DimobFieldSpec {
  key: string;
  label: string;
  length: number;
  type: DimobFieldType;
  literal?: string;
  required?: boolean;
}

/** Campo com posição inicial 1-based já calculada. */
export interface DimobField extends DimobFieldSpec {
  start: number;
}

export interface DimobRecordLayout {
  record: string;
  totalLength: number;
  fields: DimobField[];
}

/** Deriva `start` contíguo e `totalLength` a partir da ordem + `length`. */
function buildLayout(record: string, specs: DimobFieldSpec[]): DimobRecordLayout {
  let cursor = 1;
  const fields: DimobField[] = specs.map((spec) => {
    const field: DimobField = { ...spec, start: cursor };
    cursor += spec.length;
    return field;
  });
  return { record, totalLength: cursor - 1, fields };
}

/** R01 — Dados Iniciais (declarante). Uma linha por declaração. */
export const R01_LAYOUT = buildLayout("R01", [
  { key: "tipo", label: "Tipo de registro", length: 3, type: "const", literal: "R01" },
  { key: "cnpjDeclarante", label: "CNPJ do declarante", length: 14, type: "doc", required: true },
  { key: "anoCalendario", label: "Ano-calendário", length: 4, type: "year", required: true },
  { key: "retificadora", label: "Declaração retificadora (0/1)", length: 1, type: "num" },
  { key: "numeroRecibo", label: "Número do recibo (se retificadora)", length: 10, type: "num" },
  { key: "situacaoEspecial", label: "Situação especial (0/1)", length: 1, type: "num" },
  { key: "dataEventoEspecial", label: "Data do evento especial", length: 8, type: "date" },
  { key: "codigoSituacaoEspecial", label: "Código da situação especial", length: 2, type: "num" },
  { key: "nomeEmpresarial", label: "Nome empresarial", length: 60, type: "text", required: true },
  { key: "cpfResponsavel", label: "CPF do responsável perante a RFB", length: 11, type: "num", required: true },
  { key: "endereco", label: "Endereço completo", length: 120, type: "text" },
  { key: "uf", label: "UF do contribuinte", length: 2, type: "text", required: true },
  { key: "codigoMunicipio", label: "Código do município (RFB/IBGE)", length: 4, type: "num", required: true },
  { key: "reservado1", label: "Reservado", length: 20, type: "reserved" },
  { key: "reservado2", label: "Reservado", length: 10, type: "reserved" },
]);

/**
 * R04 — Intermediação de Venda (alienação). Uma linha por operação; múltiplos
 * proprietários/compradores => uma linha por parte com rateio proporcional de
 * valor e comissão (FAQ RFB p23/p47/p60).
 */
export const R04_LAYOUT = buildLayout("R04", [
  { key: "tipo", label: "Tipo de registro", length: 3, type: "const", literal: "R04" },
  { key: "cnpjDeclarante", label: "CNPJ do declarante", length: 14, type: "doc", required: true },
  { key: "anoCalendario", label: "Ano-calendário", length: 4, type: "year", required: true },
  { key: "sequencial", label: "Sequencial da operação", length: 5, type: "num", required: true },
  { key: "cpfCnpjComprador", label: "CPF/CNPJ do comprador", length: 14, type: "doc", required: true },
  { key: "nomeComprador", label: "Nome do comprador", length: 60, type: "text", required: true },
  { key: "cpfCnpjVendedor", label: "CPF/CNPJ do vendedor", length: 14, type: "doc", required: true },
  { key: "nomeVendedor", label: "Nome do vendedor", length: 60, type: "text", required: true },
  { key: "numeroContrato", label: "Número do contrato", length: 6, type: "num" },
  { key: "dataContrato", label: "Data do contrato", length: 8, type: "date", required: true },
  { key: "valorAlienacao", label: "Valor da alienação (operação)", length: 14, type: "money", required: true },
  { key: "valorComissao", label: "Valor da comissão do declarante", length: 14, type: "money", required: true },
  { key: "tipoImovel", label: "Tipo do imóvel (urbano/rural)", length: 1, type: "num" },
  { key: "enderecoImovel", label: "Endereço do imóvel", length: 60, type: "text" },
  { key: "cepImovel", label: "CEP do imóvel", length: 8, type: "num" },
  { key: "codigoMunicipioImovel", label: "Código do município do imóvel", length: 4, type: "num" },
  { key: "reservado1", label: "Reservado", length: 20, type: "reserved" },
  { key: "ufImovel", label: "UF do imóvel", length: 2, type: "text" },
  { key: "reservado2", label: "Reservado", length: 10, type: "reserved" },
]);

/** 12 meses × {aluguel, comissão, imposto}, agrupados por mês (padrão do R02). */
function monthlyLeaseFields(): DimobFieldSpec[] {
  const out: DimobFieldSpec[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ key: `aluguel_${m}`, label: `Aluguel mês ${m}`, length: 14, type: "money" });
    out.push({ key: `comissao_${m}`, label: `Comissão mês ${m}`, length: 14, type: "money" });
    out.push({ key: `imposto_${m}`, label: `Imposto retido mês ${m}`, length: 14, type: "money" });
  }
  return out;
}

/**
 * R02 — Locação (aluguéis). Uma linha por LOCADOR (agrega imóveis/contratos do
 * mesmo locador — FAQ RFB p71/p72). Valores mensais nos 12 meses do ano-calendário.
 */
export const R02_LAYOUT = buildLayout("R02", [
  { key: "tipo", label: "Tipo de registro", length: 3, type: "const", literal: "R02" },
  { key: "cnpjDeclarante", label: "CNPJ do declarante", length: 14, type: "doc", required: true },
  { key: "anoCalendario", label: "Ano-calendário", length: 4, type: "year", required: true },
  { key: "sequencial", label: "Sequencial da locação", length: 5, type: "num", required: true },
  { key: "cpfCnpjLocador", label: "CPF/CNPJ do locador", length: 14, type: "doc", required: true },
  { key: "nomeLocador", label: "Nome do locador", length: 60, type: "text", required: true },
  { key: "cpfCnpjLocatario", label: "CPF/CNPJ do locatário", length: 14, type: "doc", required: true },
  { key: "nomeLocatario", label: "Nome do locatário", length: 60, type: "text", required: true },
  { key: "numeroContrato", label: "Número do contrato", length: 6, type: "num" },
  { key: "dataContrato", label: "Data do contrato", length: 8, type: "date" },
  ...monthlyLeaseFields(),
  { key: "tipoImovel", label: "Tipo do imóvel (urbano/rural)", length: 1, type: "num" },
  { key: "enderecoImovel", label: "Endereço do imóvel", length: 60, type: "text" },
  { key: "cepImovel", label: "CEP do imóvel", length: 8, type: "num" },
  { key: "codigoMunicipioImovel", label: "Código do município do imóvel", length: 4, type: "num" },
  { key: "reservado1", label: "Reservado", length: 20, type: "reserved" },
  { key: "ufImovel", label: "UF do imóvel", length: 2, type: "text" },
  { key: "reservado2", label: "Reservado", length: 10, type: "reserved" },
]);

export const DIMOB_LAYOUTS = {
  R01: R01_LAYOUT,
  R02: R02_LAYOUT,
  R04: R04_LAYOUT,
} as const;

/** Separador de linha do arquivo DIMOB (CRLF). */
export const DIMOB_LINE_SEPARATOR = "\r\n";

/**
 * Versão do leiaute. INCREMENTAR sempre que as posições/tamanhos mudarem
 * (ex.: após calibrar contra o PGD real). O selo "leiaute validado" da org só
 * vale enquanto casar com esta versão — se ela mudar, o selo cai e o banner
 * "provisório" volta automaticamente.
 */
export const DIMOB_LAYOUT_VERSION = "2026-07-provisorio-2-r02";
