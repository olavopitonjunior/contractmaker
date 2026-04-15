export type TargetKind = "vendedor" | "comprador" | "imovel";

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
  | "indeterminado";

export interface NormalizedResult {
  situacao: Situacao;
  validade?: string | null;
  emissao?: string | null;
  detalhes?: string | null;
  consta_debito?: boolean;
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
  site_receipts?: string[];
  errors?: string[];
  header?: Record<string, unknown>;
}
