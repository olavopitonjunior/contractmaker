import type { AgentKey } from "./agents/registry";

export interface AgentContext {
  contractId: string;
  userId: string;
  orgId: string;
  htmlContent: string;
  dataJson: Record<string, unknown>;
  // `templateSource` FOI REMOVIDO em 2026-08-01. Ele carregava o Handlebars
  // inteiro do template — 31 kB dos 70 kB do contexto — e era serializado pelo
  // checkpointer do LangGraph a cada turno. Nenhum consumidor do chat lia o
  // campo: o único que precisa dele (`createContractMemory`) relê do banco por
  // conta própria. Se algum dia um nó precisar do template, busque ali; não
  // volte a arrastá-lo pelo state.
  templateModalidade?: string;
  templateName?: string;
  /** "venda" | "locacao" — discrimina o domínio do agente (prompts/contexto). */
  dealKind?: string;
  /** Deal do contrato — atribuição analítica (AIUsage.dealId). */
  dealId?: string | null;
  activeClauses: { id: string; clauseId: string; title: string; category: string; position: number; isActive: boolean }[];
  /** Quando setado, o conteúdo do contrato vive em um Google Doc; tools de
   *  edição roteiam via Docs API em vez de mutar `htmlContent`. */
  googleDocId?: string | null;
  /** Session ativa do chat (necessário pra `propose_plan` persistir o ChatPlan
   *  com sessionId correto). Setado pelo streamContractAgent ao montar contexto. */
  sessionId?: string;
  /**
   * Confiança dos itens que a busca devolveu NESTE turn: `id → lowConfidence`.
   *
   * `query_knowledge_base` devolve topK sem piso, marcando os fracos. Sem este
   * registro, o modelo recebia um id fraco e podia inseri-lo por id — pulando o
   * fail-safe de similaridade que o caminho `clauseQuery` tem. O próprio código
   * registrava isso como backlog.
   *
   * Objeto simples (JSON-safe) porque o `AgentContext` vive dentro do state do
   * LangGraph e é persistido pelo checkpointer.
   */
  ragConfidence?: Record<string, boolean>;
  /**
   * Execução de plano APROVADO por humano (`/chat/execute-plan`).
   *
   * O id de um step aprovado tem endosso de quem leu o título no PlanCard —
   * aplicar o gate de confiança aqui transformaria aprovação humana em
   * `no_match` e regrediria o plan-and-approve.
   */
  humanApprovedPlan?: boolean;
  /** Agente que está executando o turn — define o escopo de RAG (`AgentProfile.ragScope`
   *  + `KnowledgeItem.visibleToAgents`). Ausente = escopo aberto, que é o
   *  comportamento do chat legado e de quem chama tool fora do orquestrador. */
  agentKey?: AgentKey;
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
      /**
       * Opcional desde 2026-07-31. No orquestrador o preâmbulo passou a ser
       * carregado DENTRO de cada especialista (pra respeitar o escopo de RAG
       * daquele agente), então no `started` — que é emitido antes do router —
       * a informação ainda não existe. O chat legado, que carrega antes, segue
       * preenchendo. Eventos já persistidos mantêm o campo.
       */
      hasExpertContext?: boolean;
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
      status: "executed" | "failed" | "rejected" | "skipped";
      summary?: string;
    }
  | {
      type: "done";
      result: AgentResult;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      /** Multi-agente: especialista começou a executar.
       *  Emitido pelo graph (F1+) entre `started` e o primeiro `tool_use`. */
      type: "agent_started";
      agent: "analyst" | "legal" | "editor" | "curator" | "orchestrator";
      model: string;
    }
  | {
      /** Multi-agente: especialista terminou. UI fecha o chip. */
      type: "agent_completed";
      agent: "analyst" | "legal" | "editor" | "curator" | "orchestrator";
      success: boolean;
      /** Resumo curto pra UI (1 frase). */
      summary?: string;
    }
  | {
      /** Multi-agente: PostgresSaver persistiu checkpoint do turn. Útil para
       *  UI de auditoria/time-travel em F3. */
      type: "checkpoint_saved";
      turnIndex: number;
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
  /**
   * IDs de steps anteriores cujo SUCESSO este step pressupõe. Se qualquer
   * dependência não for executada com sucesso, o execute-plan PULA este step
   * (status "skipped") em vez de rodá-lo com premissa falsa — ex.: um
   * add_comment que afirma "a cláusula X inserida acima" não deve gravar nada
   * se o insert_clause falhou.
   */
  dependsOn?: string[];
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "skipped";
  /** Populado apos execucao. */
  result?: { success: boolean; summary: string };
}
