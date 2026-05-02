export interface AgentContext {
  contractId: string;
  userId: string;
  orgId: string;
  htmlContent: string;
  dataJson: Record<string, unknown>;
  templateSource: string;
  templateModalidade?: string;
  templateName?: string;
  activeClauses: { id: string; clauseId: string; title: string; category: string; position: number; isActive: boolean }[];
  /** Quando setado, o conteúdo do contrato vive em um Google Doc; tools de
   *  edição roteiam via Docs API em vez de mutar `htmlContent`. */
  googleDocId?: string | null;
}

export interface AgentResult {
  message: string;
  htmlContent: string | null;
  dataJson: Record<string, unknown> | null;
  changeLogs: ChangeLogEntry[];
}

export interface ChangeLogEntry {
  action: string;
  summary: string;
  details: Record<string, unknown>;
  source: "ai" | "user" | "system";
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface ClauseSuggestion {
  clauseId?: string;
  category: string;
  title: string;
  reason: string;
  importance: "critical" | "high" | "medium" | "low";
}

export interface ExtractionResult {
  documentType: string;
  fields: Record<string, string>;
  confidence: number;
  rawText?: string;
}
