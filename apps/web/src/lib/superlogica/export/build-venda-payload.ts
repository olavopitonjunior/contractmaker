// Mapeador PURO: SalesForm.dataJson (compra_venda_v1) + Deal + padrões da org
// + ids já resolvidos na Superlógica → payloads de pessoa, imóvel e venda.
// Sem I/O, sem Prisma: o orquestrador (PR 3) resolve ids e chama daqui.
// Tabela campo a campo em docs/integracoes/superlogica-vendas-export.md §2.2.
//
// Datas: a Superlógica recebe DIA (MM/DD/YYYY) e a imobiliária vive em
// America/Sao_Paulo. Todo instante é convertido para o dia de SP antes de
// formatar — na Vercel (UTC) uma assinatura às 21h30 de BRT já é "amanhã".

import { parseMoneyBR, parsePercentBR } from "@/lib/format/money";
import type {
  SLImovelCreateInput,
  SLPessoaCreateInput,
  SLVendaPutPayload,
} from "../types";

// ---------------------------------------------------------------------------
// 0. Datas e números.
// ---------------------------------------------------------------------------

export const SUPERLOGICA_TIME_ZONE = "America/Sao_Paulo";

const spParts = new Intl.DateTimeFormat("en-US", {
  timeZone: SUPERLOGICA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Instante → { y, m, d } no calendário de São Paulo. */
function spDate(d: Date): { y: number; m: number; d: number } {
  const parts = Object.fromEntries(spParts.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Instante → "MM/DD/YYYY" no dia de São Paulo. */
export function toApiDay(d: Date): string {
  const { y, m, d: day } = spDate(d);
  return `${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y}`;
}

/** Mesmo dia de SP + N dias (aritmética no calendário, âncora ao meio-dia). */
export function addDaysSP(d: Date, days: number): Date {
  const { y, m, d: day } = spDate(d);
  // 15:00 UTC = 12:00 BRT: nunca cruza a meia-noite de SP em nenhum DST.
  return new Date(Date.UTC(y, m - 1, day + days, 15, 0, 0));
}

/**
 * Data digitada no formulário ("YYYY-MM-DD" ou "DD/MM/YYYY") → "MM/DD/YYYY".
 * Sem fuso: é um dia civil (nascimento). Inválida → undefined.
 */
export function formDateToApi(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else if (br) {
    d = Number(br[1]); m = Number(br[2]); y = Number(br[3]);
  } else {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return undefined;
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

/** "1234.5" — ponto decimal, 2 casas, sem separador de milhar. */
export function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
/** Percentual com até 2 casas, sem zeros à direita ("48", "21.67"). */
export function percent(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Divide 100% em n partes de 2 casas cuja soma é EXATAMENTE 100.00 — o resto
 * vai para a primeira (principal). 3 → ["33.34","33.33","33.33"].
 */
export function splitEqual(n: number): string[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n); // em centésimos
  const parts = Array.from({ length: n }, () => base);
  parts[0] += 10000 - base * n;
  return parts.map((c) => (c / 100).toFixed(2));
}

// ---------------------------------------------------------------------------
// 1. Extração tolerante do formulário (o dataJson é Json livre no banco).
// ---------------------------------------------------------------------------

export interface VendaSourceEndereco {
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string; // só dígitos
}

export interface VendaSourceParty {
  index: number;
  role: "vendedor" | "comprador";
  tipoPessoa: "fisica" | "juridica";
  nome: string;
  /** CPF/CNPJ só dígitos ("" quando ausente). */
  documento: string;
  rg: string;
  sexo: "m" | "f" | "";
  /** Como veio do form ("" quando ausente); convertida em `formDateToApi`. */
  dataNascimento: string;
  nacionalidade: string;
  estadoCivil: string;
  profissao: string;
  email: string;
  celular: string; // só dígitos
  endereco: VendaSourceEndereco;
}

export type ComissionadoPapel =
  | "captador"
  | "intermediador"
  | "indicador"
  | "imobiliaria_principal"
  | "outro";

export interface VendaSourceComissionado {
  index: number;
  nome: string;
  tipoPessoa: "fisica" | "juridica";
  documento: string;
  creci: string;
  email: string;
  celular: string;
  percentual?: number;
  valor?: number;
  papel: ComissionadoPapel;
}

export interface VendaSourceImovel {
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  matricula: string;
  cartorio: string;
  inscricaoIptu: string;
  descricao: string;
}

export type QuemPagaComissao = "vendedor" | "comprador" | "ambos" | "outro";

export interface VendaSource {
  vendedores: VendaSourceParty[];
  compradores: VendaSourceParty[];
  comissionados: VendaSourceComissionado[];
  imoveis: VendaSourceImovel[];
  /** `pagamento.valor_total` (undefined quando 0/ausente/inválido). */
  valorTotal?: number;
  comissao: {
    valor?: number;
    percentual?: number;
    quemPaga: QuemPagaComissao;
    quandoPaga: string;
    prazoDias?: number;
    formaPreferida: "pix" | "boleto" | "qualquer";
  };
}

type Dict = Record<string, unknown>;

function obj(v: unknown): Dict {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
/** Dinheiro (aceita "850.000,00", "1000.00", número); 0/inválido → undefined. */
function moneyNum(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = parseMoneyBR(v);
  return n > 0 ? n : undefined;
}
/** Percentual (aceita "6,5", "6.5"); 0/inválido → undefined. */
function percentNum(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = parsePercentBR(v);
  return n > 0 ? n : undefined;
}
/** Inteiro de dias; inválido → undefined. */
function intNum(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
/** Só dígitos (CPF/CNPJ/CEP/telefone). */
export function onlyDigits(v: unknown): string {
  return str(v).replace(/\D/g, "");
}

function parseEndereco(p: Dict): VendaSourceEndereco {
  return {
    endereco: str(p.endereco ?? p.rua),
    numero: str(p.numero),
    complemento: str(p.complemento),
    bairro: str(p.bairro),
    cidade: str(p.cidade),
    uf: str(p.uf).toUpperCase().slice(0, 2),
    cep: onlyDigits(p.cep),
  };
}

function parseSexo(v: unknown): "m" | "f" | "" {
  const s = str(v).toLowerCase();
  if (s.startsWith("m")) return "m";
  if (s.startsWith("f")) return "f";
  return "";
}

function parseParty(raw: unknown, role: VendaSourceParty["role"], index: number): VendaSourceParty {
  const p = obj(raw);
  const juridica = str(p.tipo_pessoa) === "juridica" || (!str(p.nome) && !!str(p.razao_social));
  return {
    index,
    role,
    tipoPessoa: juridica ? "juridica" : "fisica",
    nome: juridica ? str(p.razao_social) || str(p.nome) : str(p.nome),
    documento: juridica ? onlyDigits(p.cnpj) || onlyDigits(p.cpf) : onlyDigits(p.cpf),
    rg: juridica ? "" : str(p.rg),
    sexo: juridica ? "" : parseSexo(p.sexo),
    dataNascimento: juridica ? "" : str(p.data_nascimento),
    nacionalidade: juridica ? "" : str(p.nacionalidade),
    estadoCivil: juridica ? "" : str(p.estado_civil),
    profissao: juridica ? "" : str(p.profissao),
    email: str(p.email),
    celular: onlyDigits(p.mobile_phone),
    endereco: parseEndereco(p),
  };
}

const PAPEIS: ComissionadoPapel[] = [
  "captador",
  "intermediador",
  "indicador",
  "imobiliaria_principal",
  "outro",
];

function parseComissionado(raw: unknown, index: number): VendaSourceComissionado {
  const c = obj(raw);
  const cnpj = onlyDigits(c.cnpj);
  const cpf = onlyDigits(c.cpf);
  const juridica = str(c.tipo_pessoa) === "juridica" || (!cpf && cnpj.length === 14);
  const papel = str(c.papel) as ComissionadoPapel;
  return {
    index,
    nome: str(c.nome) || str(c.razao_social),
    tipoPessoa: juridica ? "juridica" : "fisica",
    documento: juridica ? cnpj || cpf : cpf || cnpj,
    creci: str(c.creci),
    email: str(c.email),
    celular: onlyDigits(c.mobile_phone),
    percentual: percentNum(c.percentual),
    valor: moneyNum(c.valor),
    papel: PAPEIS.includes(papel) ? papel : "imobiliaria_principal",
  };
}

function parseImovel(raw: unknown): VendaSourceImovel {
  const i = obj(raw);
  return {
    rua: str(i.rua ?? i.endereco),
    numero: str(i.numero),
    complemento: str(i.complemento),
    bairro: str(i.bairro),
    cidade: str(i.cidade),
    uf: str(i.uf).toUpperCase().slice(0, 2),
    cep: onlyDigits(i.cep),
    matricula: str(i.matricula),
    cartorio: str(i.cartorio),
    inscricaoIptu: str(i.inscricao_iptu),
    descricao: str(i.descricao),
  };
}

function parseQuemPaga(v: unknown): QuemPagaComissao {
  const s = str(v).toLowerCase();
  if (s.startsWith("vend")) return "vendedor";
  if (s.startsWith("comp")) return "comprador";
  if (s.startsWith("amb")) return "ambos";
  return "outro";
}

/**
 * Lê o `SalesForm.dataJson` de um negócio de venda. Nunca lança: campos
 * ausentes viram "" / undefined e viram avisos no `validarVendaSource`.
 */
export function extractVendaSource(dataJson: unknown): VendaSource {
  const d = obj(dataJson);
  const comissao = obj(d.comissao);
  const pagamento = obj(d.pagamento);
  const forma = str(comissao.forma_pagamento_preferida) as "pix" | "boleto" | "qualquer";
  const comissionados = arr(comissao.comissionados).map(parseComissionado);
  // Legado (antes de `comissionados[]`): a própria imobiliária como única comissionada.
  if (comissionados.length === 0 && (str(comissao.imobiliaria_nome) || str(comissao.imobiliaria_cnpj))) {
    comissionados.push({
      index: 0,
      nome: str(comissao.imobiliaria_nome),
      tipoPessoa: "juridica",
      documento: onlyDigits(comissao.imobiliaria_cnpj),
      creci: str(comissao.creci),
      email: str(comissao.imobiliaria_email),
      celular: "",
      percentual: 100,
      papel: "imobiliaria_principal",
    });
  }
  return {
    vendedores: arr(d.vendedores).map((p, i) => parseParty(p, "vendedor", i)),
    compradores: arr(d.compradores).map((p, i) => parseParty(p, "comprador", i)),
    comissionados,
    imoveis: arr(d.imoveis).map(parseImovel),
    valorTotal: moneyNum(pagamento.valor_total),
    comissao: {
      valor: moneyNum(comissao.valor),
      percentual: percentNum(comissao.percentual),
      quemPaga: parseQuemPaga(comissao.quem_paga),
      quandoPaga: str(comissao.quando_paga),
      prazoDias: intNum(comissao.prazo_dias_apos_marco),
      formaPreferida: forma === "pix" || forma === "boleto" ? forma : "qualquer",
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Constantes da API.
// ---------------------------------------------------------------------------

/** `FL_TIPO_ANG` da Superlógica por papel do comissionado no formulário. */
export const FL_TIPO_ANG_BY_PAPEL: Record<ComissionadoPapel, string> = {
  captador: "0", // Captador/Angariador
  intermediador: "1", // Corretor Vendedor
  indicador: "7", // Indicação
  imobiliaria_principal: "6", // Imobiliária
  outro: "9", // Parceria
};

// ---------------------------------------------------------------------------
// 3. Pessoas e imóvel.
// ---------------------------------------------------------------------------

function observacaoPessoa(p: VendaSourceParty): string | undefined {
  const bits = [
    p.estadoCivil && `estado civil: ${p.estadoCivil}`,
    p.profissao && `profissão: ${p.profissao}`,
  ].filter(Boolean);
  return bits.length ? `Contractmaker — ${bits.join("; ")}` : undefined;
}

/** `POST proprietarios` para vendedor ou comprador (flag de comprador vai na venda). */
export function buildPessoaPayload(p: VendaSourceParty): SLPessoaCreateInput {
  const e = p.endereco;
  const nasc = formDateToApi(p.dataNascimento);
  const obs = observacaoPessoa(p);
  return {
    ST_NOME_PES: p.nome,
    ...(p.documento ? { ST_CNPJ_PES: p.documento } : {}),
    ...(p.rg ? { ST_RG_PES: p.rg } : {}),
    ...(p.sexo ? { ST_SEXO_PES: p.sexo === "m" ? 1 : 2 } : {}),
    ...(nasc ? { DT_NASCIMENTO_PES: nasc } : {}),
    ...(p.nacionalidade ? { ST_NACIONALIDADE_PES: p.nacionalidade } : {}),
    ...(p.email ? { ST_EMAIL_PES: p.email } : {}),
    ...(p.celular ? { ST_CELULAR_PES: p.celular } : {}),
    ...(e.cep ? { ST_CEP_PES: e.cep } : {}),
    ...(e.endereco ? { ST_ENDERECO_PES: e.endereco } : {}),
    ...(e.numero ? { ST_NUMERO_PES: e.numero } : {}),
    ...(e.complemento ? { ST_COMPLEMENTO_PES: e.complemento } : {}),
    ...(e.bairro ? { ST_BAIRRO_PES: e.bairro } : {}),
    ...(e.cidade ? { ST_CIDADE_PES: e.cidade } : {}),
    ...(e.uf ? { ST_ESTADO_PES: e.uf } : {}),
    ...(obs ? { ST_OBSERVACAO_PES: obs } : {}),
    FL_PROPRIETARIOBENEFICIARIO_PES: 1,
  };
}

/** `POST corretores` para um comissionado sem par na Superlógica. */
export function buildCorretorPayload(c: VendaSourceComissionado): SLPessoaCreateInput {
  return {
    ST_NOME_PES: c.nome,
    ...(c.documento ? { ST_CNPJ_PES: c.documento } : {}),
    ...(c.email ? { ST_EMAIL_PES: c.email } : {}),
    ...(c.celular ? { ST_CELULAR_PES: c.celular } : {}),
    ...(c.creci ? { ST_OBSERVACAO_PES: `CRECI ${c.creci} (Contractmaker)` } : {}),
    FL_CORRETOR_PES: 1,
  };
}

export interface ImovelBuildInput {
  imovel: VendaSourceImovel;
  dealId: string;
  /** Vendedores já criados na Superlógica, na ordem do form. */
  proprietarios: Array<{ idPessoa: string }>;
  tipoImovel: number;
  valorVenda?: number;
}

/** Identificador externo do imóvel na Superlógica (dedupe por negócio). */
export function imovelIdentificador(dealId: string): string {
  return `cm:${dealId}`;
}

/**
 * `POST imoveis`. Fração dos proprietários = partes iguais (o formulário de
 * venda não tem campo de fração por vendedor — `recebimento` é conta/PIX);
 * com mais de um vendedor o `validarVendaSource` emite `fracao_assumida`.
 */
export function buildImovelPayload(input: ImovelBuildInput): SLImovelCreateInput {
  const { imovel, proprietarios } = input;
  const fracoes = splitEqual(proprietarios.length);
  return {
    ST_TIPO_IMO: String(input.tipoImovel),
    ST_CEP_IMO: imovel.cep,
    ST_ENDERECO_IMO: imovel.rua,
    ST_NUMERO_IMO: imovel.numero,
    ST_COMPLEMENTO_IMO: imovel.complemento,
    ST_BAIRRO_IMO: imovel.bairro,
    ST_CIDADE_IMO: imovel.cidade,
    ST_ESTADO_IMO: imovel.uf,
    ST_IDENTIFICADOR_IMO: imovelIdentificador(input.dealId),
    ...(input.valorVenda ? { VL_VENDA_IMO: money(input.valorVenda) } : {}),
    PROPRIETARIOS_BENEFICIARIOS: proprietarios.map((p, i) => ({
      ID_PESSOA_PES: p.idPessoa,
      FL_PROPRIETARIO_PRB: i === 0 ? "-1" : "1",
      NM_FRACAO_PRB: fracoes[i],
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. Venda.
// ---------------------------------------------------------------------------

export interface VendaExportDefaults {
  contaBancariaId: number | null;
  filialId: number;
  tipoImovelPadrao: number;
  tipoPagamentoComissao: number;
  tipoRecebimentoComissao: number;
  emitirNf: boolean;
  gerarDimob: boolean;
  vencimentoDias: number;
  tetoValorCents: number;
}

export interface VendaDealInfo {
  id: string;
  title: string;
  value?: number | null;
  /**
   * Instante da assinatura: `Envelope.closedAt` (assinatura no sistema) ou
   * `Deal.contractSignedAt` (override manual) — o orquestrador resolve a
   * mesma cascata de `lib/pipeline/deal-dates.ts`. Null → "hoje" + aviso.
   */
  contractSignedAt?: Date | string | null;
}

export interface ResolvedIds {
  imovelId: string;
  /** index do comprador no form → id_pessoa_pes. */
  compradores: Record<number, string>;
  /** index do comissionado no form → ids na Superlógica (favorecido é obrigatório). */
  comissionados: Record<number, { idPessoa: string; idFavorecido?: string }>;
}

export type WarningCode =
  | "sem_comprador"
  | "sem_vendedor"
  | "sem_imovel"
  | "sem_valor"
  | "acima_do_teto"
  | "sem_conta_bancaria"
  | "sem_comissao"
  | "sem_comissionado"
  | "comissao_divergente"
  | "soma_comissionados"
  | "documento_ausente"
  | "data_invalida"
  | "data_venda_hoje"
  | "tipo_imovel_padrao"
  | "imoveis_extras"
  | "fracao_assumida"
  | "quem_paga_ambos"
  | "quem_paga_indefinido"
  | "comissionado_sem_id"
  | "comissionado_sem_favorecido"
  | "comprador_sem_id"
  | "imovel_sem_id"
  | "cobranca_asaas_ativa"
  | "exportacao_em_andamento";

export interface ExportWarning {
  code: WarningCode;
  message: string;
  blocking: boolean;
}

export interface ComissaoCalculada {
  total: number;
  percentualSobreVenda: number;
  itens: Array<{
    index: number;
    nome: string;
    valor: number;
    /** participação na comissão (%), = VL_COMISSAO_ANG */
    participacao: number;
    papel: ComissionadoPapel;
  }>;
}

/**
 * Comissão total e a parte de cada comissionado. Regras:
 *  - total = `comissao.valor` > 0; senão `percentual` × valor da venda; senão
 *    soma de `comissionados[].valor`.
 *  - parte_i = `valor_i`; senão `percentual_i` × total; senão total / n.
 */
export function calcularComissao(source: VendaSource): ComissaoCalculada {
  const valorVenda = source.valorTotal ?? 0;
  const somaValores = source.comissionados.reduce((a, c) => a + (c.valor ?? 0), 0);
  let total = 0;
  if (source.comissao.valor && source.comissao.valor > 0) total = source.comissao.valor;
  else if (source.comissao.percentual && valorVenda > 0)
    total = (valorVenda * source.comissao.percentual) / 100;
  else total = somaValores;
  const n = Math.max(source.comissionados.length, 1);
  const itens = source.comissionados.map((c) => {
    const valor =
      c.valor && c.valor > 0
        ? c.valor
        : c.percentual && c.percentual > 0
          ? (total * c.percentual) / 100
          : total / n;
    return {
      index: c.index,
      nome: c.nome,
      valor: Math.round(valor * 100) / 100,
      participacao: total > 0 ? Math.round((valor / total) * 10000) / 100 : 0,
      papel: c.papel,
    };
  });
  return {
    total: Math.round(total * 100) / 100,
    percentualSobreVenda:
      valorVenda > 0 ? Math.round((total / valorVenda) * 10000) / 100 : source.comissao.percentual ?? 0,
    itens,
  };
}

/** `Date`/ISO válidos → Date; null/inválido → null. */
function toInstant(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface BuildVendaInput {
  source: VendaSource;
  deal: VendaDealInfo;
  defaults: VendaExportDefaults;
  ids: ResolvedIds;
  /** "Hoje" injetável para testes. */
  now?: Date;
}

export interface BuildVendaResult {
  payload: SLVendaPutPayload;
  warnings: ExportWarning[];
  comissao: ComissaoCalculada;
  /** Datas já no formato da API (para o preview mostrar o que vai). */
  datas: { venda: string; vencimento: string };
}

/**
 * Só os AVISOS, sem exigir ids (o preview roda antes de criar qualquer coisa
 * na Superlógica). `buildVendaPayload` repete estes e soma os de id.
 */
export function validarVendaSource(
  source: VendaSource,
  deal: VendaDealInfo,
  defaults: VendaExportDefaults,
): { warnings: ExportWarning[]; comissao: ComissaoCalculada; valorVenda: number } {
  const warnings: ExportWarning[] = [];
  const push = (code: WarningCode, message: string, blocking: boolean) =>
    warnings.push({ code, message, blocking });
  const valorVenda = source.valorTotal ?? (deal.value && deal.value > 0 ? deal.value : 0);

  if (source.compradores.length === 0) push("sem_comprador", "O formulário não tem comprador.", true);
  if (source.vendedores.length === 0) push("sem_vendedor", "O formulário não tem vendedor (proprietário).", true);
  if (source.imoveis.length === 0) push("sem_imovel", "O formulário não tem imóvel.", true);
  if (source.imoveis.length > 1)
    push(
      "imoveis_extras",
      `${source.imoveis.length} imóveis no formulário: só o primeiro vai para a Superlógica; os demais entram na observação.`,
      false,
    );
  if (!(valorVenda > 0)) push("sem_valor", "Valor da venda ausente (pagamento.valor_total e valor do negócio).", true);
  if (valorVenda * 100 > defaults.tetoValorCents)
    push("acima_do_teto", `Valor da venda acima do teto configurado para exportação (R$ ${money(defaults.tetoValorCents / 100)}).`, true);
  if (!defaults.contaBancariaId)
    push("sem_conta_bancaria", "Conta bancária das parcelas não definida em Configurações › Integrações › Superlógica.", true);

  const comissao = calcularComissao({ ...source, valorTotal: valorVenda || undefined });
  if (!(comissao.total > 0)) push("sem_comissao", "Comissão total ausente ou zero.", true);
  if (source.comissionados.length === 0) push("sem_comissionado", "Nenhum comissionado no formulário.", true);
  if (
    source.comissao.valor &&
    source.comissao.percentual &&
    valorVenda > 0 &&
    Math.abs((valorVenda * source.comissao.percentual) / 100 - source.comissao.valor) > 1
  )
    push("comissao_divergente", "Percentual e valor da comissão no formulário divergem; o valor prevalece.", false);
  const somaPart = comissao.itens.reduce((a, i) => a + i.participacao, 0);
  if (comissao.itens.length > 0 && Math.abs(somaPart - 100) > 0.5)
    push("soma_comissionados", `As partes dos comissionados somam ${percent(somaPart)}% da comissão, não 100%.`, false);

  for (const p of [...source.vendedores, ...source.compradores]) {
    const rotulo = `${p.role === "vendedor" ? "Vendedor" : "Comprador"} "${p.nome || `#${p.index + 1}`}"`;
    if (!p.documento) push("documento_ausente", `${rotulo} sem CPF/CNPJ: será cadastrado só pelo nome.`, false);
    if (p.dataNascimento && !formDateToApi(p.dataNascimento))
      push("data_invalida", `${rotulo} com data de nascimento ilegível ("${p.dataNascimento}"): será cadastrado sem ela.`, false);
  }
  for (const c of source.comissionados)
    if (!c.documento)
      push("documento_ausente", `Comissionado "${c.nome || `#${c.index + 1}`}" sem CPF/CNPJ: será criado como corretor só pelo nome.`, false);
  if (source.vendedores.length > 1)
    push("fracao_assumida", `${source.vendedores.length} vendedores: a fração de cada um no imóvel será igual (o formulário não informa a divisão).`, false);
  if (!toInstant(deal.contractSignedAt))
    push("data_venda_hoje", "Sem data de assinatura registrada: a data da venda será a de hoje.", false);
  push("tipo_imovel_padrao", "O formulário de venda não informa o tipo do imóvel; será usado o padrão da organização.", false);
  if (source.comissao.quemPaga === "ambos")
    push(
      "quem_paga_ambos",
      "Comissão paga por ambas as partes (50/50): a Superlógica só aceita um pagador por venda. Ajuste o formulário ou lance a segunda metade à mão.",
      true,
    );
  else if (source.comissao.quemPaga === "outro")
    push("quem_paga_indefinido", "\"Quem paga a comissão\" não é vendedor nem comprador; será usado o padrão da organização.", false);
  return { warnings, comissao, valorVenda };
}

function vendaObservacao(deal: VendaDealInfo, source: VendaSource): string {
  const bits = [`Contractmaker negócio ${deal.id} — ${deal.title}`.trim()];
  const im = source.imoveis[0];
  if (im?.matricula) bits.push(`matrícula ${im.matricula}${im.cartorio ? ` (${im.cartorio})` : ""}`);
  if (source.imoveis.length > 1) {
    const extras = source.imoveis
      .slice(1)
      .map((i) => [i.rua, i.numero, i.bairro, i.cidade].filter(Boolean).join(", "))
      .join(" | ");
    bits.push(`outros imóveis: ${extras}`);
  }
  return bits.join("; ").slice(0, 1000);
}

/**
 * Monta o payload de `vendas/put`. Puro e determinístico (injete `now`).
 * Lança `VendaExportBlockedError` se houver aviso bloqueante — chame
 * `validarVendaSource` antes para mostrar tudo no preview.
 */
export function buildVendaPayload(input: BuildVendaInput): BuildVendaResult {
  const { source, deal, defaults, ids } = input;
  const now = input.now ?? new Date();
  const { warnings, comissao, valorVenda } = validarVendaSource(source, deal, defaults);
  const push = (code: WarningCode, message: string) => warnings.push({ code, message, blocking: true });

  for (const p of source.compradores)
    if (!ids.compradores[p.index]) push("comprador_sem_id", `Comprador #${p.index + 1} sem id na Superlógica.`);
  for (const c of source.comissionados) {
    const id = ids.comissionados[c.index];
    if (!id?.idPessoa) push("comissionado_sem_id", `Comissionado #${c.index + 1} sem id na Superlógica.`);
    else if (!id.idFavorecido)
      push("comissionado_sem_favorecido", `Comissionado #${c.index + 1} sem favorecido na Superlógica (ler em corretores?id=${id.idPessoa} antes de montar).`);
  }
  if (!ids.imovelId) push("imovel_sem_id", "Imóvel sem id na Superlógica.");

  const blocking = warnings.filter((w) => w.blocking);
  if (blocking.length) throw new VendaExportBlockedError(blocking);

  const dataVenda = toInstant(deal.contractSignedAt) ?? now;
  const prazo = source.comissao.prazoDias ?? defaults.vencimentoDias;
  const dtVenda = toApiDay(dataVenda);
  const dtVenc = toApiDay(addDaysSP(dataVenda, Math.max(0, prazo)));

  const fracoesCompradores = splitEqual(source.compradores.length);
  const tipoRecebimento: "0" | "1" =
    source.comissao.quemPaga === "vendedor"
      ? "0"
      : source.comissao.quemPaga === "comprador"
        ? "1"
        : defaults.tipoRecebimentoComissao === 1
          ? "1"
          : "0";

  const vendedores = source.comissionados.map((c) => {
    const item = comissao.itens.find((i) => i.index === c.index)!;
    const id = ids.comissionados[c.index];
    return { c, item, idPessoa: id.idPessoa, idFavorecido: id.idFavorecido as string };
  });

  const payload: SLVendaPutPayload = {
    ID_IMOVEL_IMO: ids.imovelId,
    DT_VENDA_VEN: dtVenda,
    VL_TOTAL_VEN: money(valorVenda),
    TX_COMISSAO_VEN: percent(comissao.percentualSobreVenda),
    VL_TOTALCOMISSAO_VEN: money(comissao.total),
    VL_COMISSAO_VEN: money(comissao.total),
    NM_PARCELAS: "1",
    VENDAS_COMPRADORES: source.compradores.map((p, i) => ({
      ST_NOME_PES: p.nome,
      FL_PROPRIETARIOBENEFICIARIO_PES: "1",
      FL_COMPRADOR_PES: "1",
      ID_PESSOA_PES: ids.compradores[p.index],
      NM_FRACAO_VEC: fracoesCompradores[i],
      FL_PRINCIPAL_VEC: i === 0 ? "1" : "0",
    })),
    VENDEDORES: vendedores.map(({ c, item, idPessoa, idFavorecido }) => ({
      ST_NOME_PES: c.nome,
      ID_PESSOA_PES: "",
      VL_COMISSAO_ANG: percent(item.participacao),
      FL_VALORCOMISSAO_ANG: "1",
      FL_TIPO_ANG: FL_TIPO_ANG_BY_PAPEL[c.papel],
      ID_VENDEDORES_VEV: "",
      ID_VENDEDOR_VEV: idPessoa,
      ID_FAVORECIDO_FAV: idFavorecido,
    })),
    COMISSOES: vendedores.map(({ c, item, idPessoa, idFavorecido }) => ({
      ID_ITEM_VEI: "",
      ID_LANCAMENTO_VEI: "",
      FL_STATUS_MOV: "",
      DT_VENCIMENTO_VEI: dtVenc,
      ID_VENDEDOR_VEV: idPessoa,
      ID_FAVORECIDO_FAV: idFavorecido,
      ST_NOME_PES: c.nome,
      VL_ITEM_VEI: money(item.valor),
      FL_DESPESA: "0",
      NM_PARCELA_VEI: "1",
    })),
    VENDEDORPARCELA1: vendedores.map(({ c, item, idPessoa, idFavorecido }) => ({
      ID_ITEM_VEI: "",
      ID_LANCAMENTO_VEI: "",
      FL_STATUS_MOV: "",
      DT_VENCIMENTO_VEI: dtVenc,
      ST_NOME_PES: "",
      ID_VENDEDOR_VEV: idPessoa,
      ST_FANTASIA_FAV: c.nome,
      ID_FAVORECIDO_FAV: idFavorecido,
      VL_ITEM_VEI: money(item.valor),
      NM_PARCELA_VEI: "1",
    })),
    COMISSAO_PARCELAS: [
      {
        ID_RECEBIMENTO_RECB: "",
        DT_VENCIMENTO_RECB: dtVenc,
        VL_EMITIDO_RECB: money(comissao.total),
        FL_STATUS_RECB: "0",
        ST_OBSERVACAOEXTERNA_RECB: `Comissão de intermediação — ${deal.title}`.slice(0, 200),
        VL_TOTAL_RECB: money(comissao.total),
      },
    ],
    FL_NOTAFISCAL_VEN: defaults.emitirNf ? "1" : "0",
    FL_DIMOB_VEN: defaults.gerarDimob ? "1" : "0",
    FL_DESTINACAOFISCAL_VEN: "",
    ID_FILIAL_FIL: String(defaults.filialId),
    ID_CONTABANCO_CB: String(defaults.contaBancariaId),
    FL_TIPORECEBIMENTOCOMISSAO_VEN: tipoRecebimento,
    FL_TIPOPAGAMENTOCOMISSAO_VEN: defaults.tipoPagamentoComissao === 1 ? "1" : "0",
    FL_STATUS_VEN: "",
    ID_TIPO_VEN: "1",
    ST_OBSERVACAO_VEN: vendaObservacao(deal, source),
    ITENSLIQUIDADOS: "0",
  };

  return { payload, warnings, comissao, datas: { venda: dtVenda, vencimento: dtVenc } };
}

export class VendaExportBlockedError extends Error {
  constructor(public readonly warnings: ExportWarning[]) {
    super(`Exportação bloqueada: ${warnings.map((w) => w.message).join(" ")}`);
    this.name = "VendaExportBlockedError";
  }
}
