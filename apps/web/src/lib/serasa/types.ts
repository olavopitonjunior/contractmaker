/**
 * Tipos da integração Serasa Experian (API REST v2).
 *
 * 3 famílias de endpoint cobertas no MVP:
 *  1. Score (PF/PJ)      — Score 0-1000, faixa de risco, drivers
 *  2. Restritivos (PF/PJ)— Negativações, protestos, ações
 *  3. Vínculos (PJ↔PF)   — CNPJs onde um CPF é sócio/representante
 *
 * Os shapes abaixo são intencionalmente lenientes (campos optional) porque
 * a Serasa renomeia/move campos sem aviso prévio — mesma armadilha que o
 * normalizer da Infosimples enfrenta. Quando o provedor mudar a forma da
 * resposta, ajuste apenas os normalizers; os tipos aqui ficam tolerantes.
 */

export type SerasaEndpointKind = "score" | "restritivos" | "vinculos";

export interface SerasaTokenResponse {
  accessToken: string;
  // TTL em segundos (Serasa devolve `expires_in`). Mapeado em client.ts.
  expiresIn: number;
  tokenType?: string;
}

export interface SerasaScoreResponse {
  score?: number;
  faixa?: string;
  classificacao?: string;
  motivosScore?: Array<{ codigo?: string; descricao?: string }>;
  consultaProtocolo?: string;
  dataConsulta?: string;
  [k: string]: unknown;
}

export interface SerasaRestritivoItem {
  tipo?: string;
  origem?: string;
  valor?: number;
  data?: string;
  descricao?: string;
  [k: string]: unknown;
}

export interface SerasaRestritivosResponse {
  consultaProtocolo?: string;
  totalOcorrencias?: number;
  valorTotal?: number;
  pendencias?: SerasaRestritivoItem[];
  protestos?: SerasaRestritivoItem[];
  acoes?: SerasaRestritivoItem[];
  chequesSemFundo?: SerasaRestritivoItem[];
  [k: string]: unknown;
}

export interface SerasaVinculoItem {
  cnpj?: string;
  razaoSocial?: string;
  papel?: string;
  percentual?: number;
  situacao?: string;
  dataEntrada?: string;
  [k: string]: unknown;
}

export interface SerasaVinculosResponse {
  consultaProtocolo?: string;
  totalVinculos?: number;
  vinculos?: SerasaVinculoItem[];
  [k: string]: unknown;
}

export type SerasaResponse =
  | SerasaScoreResponse
  | SerasaRestritivosResponse
  | SerasaVinculosResponse;

/**
 * Erros do cliente Serasa. `status` é o HTTP status do response (ou 0 quando
 * network/timeout). `body` carrega o JSON cru — útil pro classifier rotear
 * estado rico.
 */
export class SerasaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "SerasaError";
  }
}
