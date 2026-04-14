export type TargetKind = "vendedor" | "comprador" | "imovel";

export type JobStatus =
  | "pending"
  | "fetching"
  | "awaiting_portal"
  | "success"
  | "failed"
  | "skipped";

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

export interface SkippedJob {
  endpoint: string;
  label: string;
  targetKind: TargetKind;
  targetIndex: number;
  reason: string;
  missingField: string;
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
