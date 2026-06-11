export type TargetKind =
  | "vendedor"
  | "comprador"
  | "imovel"
  | "diligenciado"
  // Dependentes do VENDEDOR — sempre diligenciados junto (decisão do usuário
  // 2026-05-22). targetIndex referencia o índice do vendedor titular.
  | "conjuge_vendedor"
  | "procurador_vendedor"
  | "representante_vendedor"
  // Locação (análise de crédito Serasa, 2026-06-10). fiador vive em
  // garantia.fiador (objeto, sem índice).
  | "locatario"
  | "fiador";

export type JobStatus =
  | "pending"
  | "fetching"
  | "awaiting_portal"
  | "success"
  | "failed"
  | "skipped"
  | "replaced";

export type Situacao =
  | "negativa"
  | "positiva"
  | "positiva_com_efeitos"
  | "nao_emitida"
  | "aguardando_pdf"
  | "informativa"          // Cartão CNPJ, Cartão CPF — consulta de dados, sem negativa/positiva
  | "sem_restricao"        // Serasa: consultado SEM pendências (verde, equivalente a "negativa" no léxico Infosimples)
  | "com_restricao"        // Serasa: consultado COM pendências (vermelho/amarelo, equivalente a "positiva")
  | "indeterminado";

// Re-exported from ./error-codes so callers that type-import from types.ts
// get it too (most legacy code imports from here).
export type {
  FailureCategory,
} from "./error-codes";

export interface NormalizedResult {
  situacao: Situacao;
  validade?: string | null;
  emissao?: string | null;
  detalhes?: string | null;
  consta_debito?: boolean;
  /**
   * When `situacao === "nao_emitida"` or `"indeterminado"`, categorizes the
   * underlying reason so the UI can render differentiated UX (edit party,
   * retry, contact admin, etc). Unset when situacao is success-like.
   */
  failureCategory?: import("./error-codes").FailureCategory;
  raw?: unknown;
}

/**
 * Camada de seleção na popup de disparo (redesign 2026-05-26):
 *   - "padrao": certidões dos vendedores (+ dependentes), nas regiões do imóvel
 *     e do endereço deles. Marcado por padrão.
 *   - "imovel": certidões do IMÓVEL (matrícula/visualização ONR, IPTU/municipal,
 *     CCIR). Seção própria, desmarcada.
 *   - "opcional": compradores e pessoas adicionadas manualmente.
 *   - "pesquisa": Pesquisa de Bens (ONR) e certidões menos comuns (extras).
 */
export type JobTier = "padrao" | "imovel" | "opcional" | "pesquisa";

/**
 * Região à qual um job pertence — usada pela UI pra sub-agrupar dentro do
 * Padrão (Nacional / Região do imóvel / Região do endereço do vendedor). Como
 * o slug do endpoint já codifica a corte (trf5, CEAT por UF) e o requestPayload
 * raramente carrega `uf`, a região é decidida e tagueada NA ORIGEM (planner).
 */
export interface JobRegion {
  kind: "nacional" | "imovel" | "endereco" | "outro";
  uf?: string;
  cidade?: string;
  label: string;
}

export interface PlannedJob {
  endpoint: string;
  label: string;
  targetKind: TargetKind;
  targetIndex: number;
  requestPayload: Record<string, unknown>;
  costCents: number;
  linkedLabel?: string; // For two-step flows (pedido -> obter), reference the sibling
  /** Camada de seleção (default marca só "padrao"). Aditivo — ver JobTier. */
  tier?: JobTier;
  /** Região do job pra sub-agrupar na UI. Aditivo — ver JobRegion. */
  region?: JobRegion;
}

/**
 * Structured description of a single field that must be filled to unblock a
 * skipped job. Used by the complement-data flow on the UI.
 */
export interface MissingField {
  /** dot-path into dealData, e.g. "vendedores.0.data_nascimento" */
  path: string;
  /** Human-readable label, e.g. "Data de nascimento de Maria Souza" */
  label: string;
  /** Input type hint for the form */
  type: "date" | "text" | "number";
  /** Placeholder / example */
  placeholder?: string;
}

export interface SkippedJob {
  endpoint: string;
  label: string;
  targetKind: TargetKind;
  targetIndex: number;
  reason: string;
  missingField: string;
  /** Structured fields that the user must fill to unblock this job */
  missingFields: MissingField[];
  /**
   * Phase F.II-γ — link externo para portal oficial quando não há cobertura
   * Infosimples (E-Proc SP 1ª/2ª, IPTU POA, etc). UI renderiza botão
   * "Abrir portal oficial" que abre em nova aba.
   */
  externalLink?: string;
  /** Camada/região (espelha PlannedJob) pra UI agrupar skips junto dos jobs. */
  tier?: JobTier;
  region?: JobRegion;
}

export interface ExtractionPlan {
  jobs: PlannedJob[];
  skipped: SkippedJob[];
  totalCostCents: number;
}

export interface InfosimplesResponse {
  code: number;
  code_message: string;
  data: Array<Record<string, unknown>>;
  data_count?: number;
  site_receipts?: string[];
  errors?: string[];
  header?: {
    billable?: boolean;
    /**
     * Preço REAL cobrado pela Infosimples nesta chamada, em BRL (ex.: 0.2 =
     * R$0,20). Varia por consulta e é específico da conta. O executor grava
     * `Math.round(price*100)` como costCents real do job (corrige orçamento +
     * histórico vs. a estimativa estática do catálogo). 2026-05-26.
     */
    price?: number;
    [key: string]: unknown;
  };
}
