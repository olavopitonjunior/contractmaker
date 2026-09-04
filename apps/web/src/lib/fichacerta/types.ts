/**
 * Tipos da API Ficha Certa Digital ("API - FC ANALISE",
 * https://doc-api.fichacertadigital.com.br/). Lidos da documentação em
 * 04/09/2026 — a doc é um Postman exportado, sem schema formal, então TUDO
 * que vem da API é opcional aqui: o normalizer absorve ruído e as fixtures
 * (lib/certidoes/__tests__/fixtures/fichacerta-*.json) quebram cedo se a
 * forma mudar.
 *
 * Modelo deles: Solicitação (1 locação) → Pretendentes (INQUILINO, FIADOR,
 * cônjuges…) → Produtos por pretendente (1 FC REPORT, 9 FC SCORE, 4 FC
 * EMPRESA). O laudo é ASSÍNCRONO: `POST /report` só enfileira; o resultado
 * chega pelo webhook (um por conta) e por `GET /report`.
 */

export class FichaCertaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "FichaCertaError";
  }
}

export type TipoPretendente =
  | "INQUILINO"
  | "FIADOR"
  | "CONJUGE_INQUILINO"
  | "CONJUGE_FIADOR"
  | "OUTROS";

export type TipoImovel = "RESIDENCIAL" | "NAO_RESIDENCIAL";

/** Status de um produto do pretendente (ciclo de vida do laudo). */
export type ProdutoStatus =
  | "INCLUIDO"
  | "SOLICITADO"
  | "ANDAMENTO"
  | "CONCLUIDO"
  | "EDITADO"
  | "REINCLUIDO";

/** Ids de produto da API. */
export const FC_PRODUTO = {
  FC_REPORT: 1,
  FC_RENDA: 2,
  FC_EMPRESA: 4,
  FC_SCORE: 9,
  FC_SCORE_PLUS: 10,
} as const;

export interface EnderecoInput {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  numero?: string;
  complemento?: string;
}

export interface LocacaoInput {
  codigo_imovel?: string;
  /** Valores como string decimal ("5000" / "100.50"), como no exemplo da doc. */
  aluguel?: string;
  condominio?: string;
  iptu?: string;
  tipo_imovel: TipoImovel;
  endereco?: EnderecoInput;
}

export interface RendaInput {
  /** `origem` é obrigatória; string vazia quando a renda não é informada. */
  principal: { origem: number | ""; valor?: string };
  outra: { origem: number | ""; valor?: string };
  /** Só quando `principal.valor` não vem. */
  credito?: string;
}

export interface PretendentePfInput {
  tipo_pretendente: Exclude<TipoPretendente, "OUTROS">;
  nome: string;
  cpf: string;
  /** ISO `YYYY-MM-DD` (formato do exemplo da doc). */
  data_nascimento?: string;
  nome_mae?: string;
  /** Obrigatório quando `locacao.tipo_imovel === "RESIDENCIAL"`. */
  residir?: boolean;
  /** Obrigatório quando `locacao.tipo_imovel === "NAO_RESIDENCIAL"`. */
  participante?: boolean;
  endereco?: EnderecoInput;
  renda: RendaInput;
}

export interface PretendentePjInput {
  tipo_pretendente: "OUTROS";
  razao_social: string;
  cnpj: string;
}

export type PretendenteInput = PretendentePfInput | PretendentePjInput;

export interface SolicitationCreateBody {
  produtos: number[];
  locacao: LocacaoInput;
  pretendente: PretendenteInput;
}

export interface ApplicantCreateBody {
  produtos: number[];
  pretendente: PretendenteInput;
}

/** PUT applicant — mesmos campos, mais as flags de "desconsiderar". */
export interface ApplicantUpdateBody {
  pretendente: Partial<PretendenteInput> & {
    cpf_pendente?: boolean;
    tem_acoes_criminais?: boolean;
    tem_alerta_fraude?: boolean;
    suspeita_obito?: boolean;
    oculto?: boolean;
  };
}

export interface CreatedResponse {
  id: number;
  message?: string;
}

export interface Produto {
  id?: number;
  nome?: string;
  status?: ProdutoStatus | string;
  data?: string;
  data_atualizacao?: string;
}

export interface SolicitationDetail {
  data?: {
    id?: number;
    status?: string;
    data_criacao?: string;
    cliente_id?: number;
    cliente_nome?: string;
    locacao?: unknown;
    pretendentes?: Array<{
      id?: number;
      tipo_pretendente?: string;
      nome?: string;
      cpf?: string;
      cnpj?: string;
      razao_social?: string;
      produtos?: Produto[];
    }>;
  };
}

export interface CreditsResponse {
  data?: { credito_disponivel?: number };
}

export type LaudoIcon = "positivo" | "neutro" | "negativo" | "nulo";

export interface LaudoBlock<T = unknown> {
  result?: T;
  icon?: LaudoIcon | string;
  recommendation?: unknown;
  caution?: unknown;
}

export interface ParecerSistemico {
  parecer?: string;
  score_fc?: number | null;
  recomendacao?: string[];
  risco?: unknown;
}

export interface RestricaoItem {
  info?: string;
  resumo?: unknown;
  detalhes?: unknown[];
}

export interface Laudo {
  data_conclusao?: string;
  restricoes_financeiras?: LaudoBlock<Record<string, RestricaoItem>>;
  situacao_cpf?: LaudoBlock<string>;
  suspeita_obito?: LaudoBlock<boolean>;
  compatibilidade_renda?: LaudoBlock<{ valor_locacao?: number; renda?: number; vezes?: number }>;
  perfil_socioeconomico?: LaudoBlock<Record<string, unknown>>;
  parecer_sistemico?: ParecerSistemico[];
  principal_origem_renda?: LaudoBlock<{ origem?: string; documentacao?: string[] }>;
  outra_origem_renda?: LaudoBlock<{ origem?: string; documentacao?: string[] }>;
  [bloco: string]: unknown;
}

export interface ReportPessoa {
  id?: number;
  tipo_pretendente?: TipoPretendente | string;
  nome?: string;
  cpf?: string;
  cnpj?: string;
  razao_social?: string;
  data_nascimento?: string;
  nome_mae?: string;
  residir?: boolean;
  participante?: boolean;
  produtos?: Produto[];
  renda?: unknown;
}

export interface ReportPretendente {
  pessoa?: ReportPessoa;
  laudo?: Laudo;
}

export interface ParecerLocacaoLado {
  parecer?: string;
  aprovados?: string | null;
  nao_aprovados?: string | null;
}

export interface ReportParecer {
  sintese?: Array<{
    cpf?: string;
    nome?: string;
    pretendente_id?: number;
    parecer?: ParecerSistemico[];
  }>;
  locacao?: {
    parecer_fiadores?: ParecerLocacaoLado | Record<string, never>;
    parecer_inquilinos?: ParecerLocacaoLado | Record<string, never>;
    risco?: string;
  };
}

/** `GET /solicitation/:id/report` — e o payload do webhook (só o pretendente que concluiu). */
export interface ReportResponse {
  solicitacao?: {
    id?: number;
    status?: string;
    cliente_id?: number;
    cliente_nome?: string;
    solicitante?: string;
    data_criacao?: string;
    data_conclusao?: string;
  };
  locacao?: unknown;
  pretendentes?: ReportPretendente[];
  parecer?: ReportParecer;
}

export type WebhookPayload = ReportResponse;

export interface WebhookConfigBody {
  endpoint: string;
  token_url?: string;
  token_user?: string;
  token_password?: string;
}

export interface WebhookConfigRow {
  id: number;
  endpoint?: string;
  token_url?: string;
  token_user?: string;
  token_password?: string;
}
