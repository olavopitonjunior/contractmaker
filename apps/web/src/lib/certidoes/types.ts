export type TargetKind = "vendedor" | "comprador" | "imovel" | "diligenciado";

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

export interface PlannedJob {
  endpoint: string;
  label: string;
  targetKind: TargetKind;
  targetIndex: number;
  requestPayload: Record<string, unknown>;
  costCents: number;
  linkedLabel?: string; // For two-step flows (pedido -> obter), reference the sibling
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
    [key: string]: unknown;
  };
}
