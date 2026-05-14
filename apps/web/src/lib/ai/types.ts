export interface AgentContext {
  contractId: string;
  userId: string;
  orgId: string;
  htmlContent: string;
  dataJson: Record<string, unknown>;
  /** Null em contratos importados (sem template Handlebars). */
  templateSource: string | null;
  templateModalidade?: string;
  templateName?: string;
  activeClauses: { id: string; clauseId: string; title: string; category: string; position: number; isActive: boolean }[];
  /** Quando setado, o conteúdo do contrato vive em um Google Doc; tools de
   *  edição roteiam via Docs API em vez de mutar `htmlContent`. */
  googleDocId?: string | null;
  /** Session ativa do chat (necessário pra `propose_plan` persistir o ChatPlan
   *  com sessionId correto). Setado pelo streamContractAgent ao montar contexto. */
  sessionId?: string;
  /** ID pre-alocado da mensagem assistant que vai carregar o turn atual.
   *  Necessario pra `propose_plan` linkar ChatPlan.messageId antes da msg
   *  existir no DB (1:1 unique). Setado pelo streamContractAgent. */
  pendingAssistantMessageId?: string;
}

export interface AgentResult {
  message: string;
  htmlContent: string | null;
  dataJson: Record<string, unknown> | null;
  changeLogs: ChangeLogEntry[];
  /** Eventos emitidos durante o turn, persistidos pra rehidratar o chip
   *  timeline ao recarregar o chat. */
  events?: AgentEvent[];
}

export interface ChangeLogEntry {
  action: string;
  summary: string;
  details: Record<string, unknown>;
  source: "ai" | "user" | "system";
  /** Texto do doc antes da tool de write executar — só populado em edits
   *  com googleDocId. Lê via getDocPlainText. Cap aplicado no persist. */
  htmlBefore?: string;
  /** Texto após a write. Pode coincidir com htmlBefore se o tool failou. */
  htmlAfter?: string;
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

/**
 * Modos do agente:
 * - `fast`: 1 iteração, Haiku, sem expert context, edição direta em GDocs.
 *   Otimizado pra latência (~2-4s). Usado em correções pontuais e no
 *   "Resolver com IA" da aba de comentários.
 * - `plan`: até 5 iterações, Sonnet por default, expert context completo,
 *   propose_suggestion preferido em GDocs. Usado quando a tarefa exige
 *   raciocínio jurídico ou múltiplas tools encadeadas.
 */
export type AgentMode = "fast" | "plan";

/**
 * Eventos emitidos pelo streamContractAgent durante o turn. Consumidos pela
 * UI (chips ao vivo) e persistidos em ChatMessage.events pra rehidratar o
 * histórico.
 */
export type AgentEvent =
  | {
      type: "started";
      mode: AgentMode;
      model: string;
      hasExpertContext: boolean;
    }
  | {
      type: "tool_use";
      name: string;
      input: Record<string, unknown>;
      iteration: number;
    }
  | {
      type: "tool_result";
      name: string;
      iteration: number;
      success: boolean;
      summary: string;
    }
  | {
      type: "verification";
      tool: string;
      verified: boolean;
      detail: string;
    }
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "plan_proposed";
      planId: string;
      steps: PlanStep[];
      /** Texto que o agente colocou junto com o propose_plan (`reasoning`). */
      reasoning?: string;
    }
  | {
      type: "plan_step_result";
      planId: string;
      stepId: string;
      status: "executed" | "failed" | "rejected";
      summary?: string;
    }
  | {
      type: "done";
      result: AgentResult;
    }
  | {
      type: "error";
      message: string;
    };

/**
 * Step de um plano proposto pelo agente em modo Plan-and-approve.
 * `read` steps sao auto-executados; `write` steps esperam aprovacao humana
 * via UI antes de rodar.
 */
export interface PlanStep {
  /** ID local (cuid) — UI usa pra checkbox/diff. */
  id: string;
  type: "read" | "write";
  /** Nome do tool em AGENT_TOOLS (validate_contract, edit_contract_section, etc). */
  tool: string;
  /** Input que sera passado pro tool. Pode ser editado pela UI antes da exec. */
  input: Record<string, unknown>;
  /** Descrição em PT-BR pra mostrar no PlanCard. */
  description: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  /** Populado apos execucao. */
  result?: { success: boolean; summary: string };
}
