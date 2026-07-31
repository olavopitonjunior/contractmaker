import type { AgentContext } from "../types";
import type { AgentEvent, AgentMode, PlanStep } from "../types";

/**
 * Estado compartilhado do graph multi-agente. Cada node recebe e devolve
 * um patch parcial; reducers (em `graph.ts`) fazem o merge.
 *
 * Schema é serializável (JSON-safe) para o `PostgresSaver` conseguir
 * persistir checkpoint por turn em `langgraph_checkpoints`.
 */
export interface OrchestratorState {
  contractId: string;
  userId: string;
  orgId: string;
  sessionId: string;

  userMessage: string;
  mode: AgentMode;

  /** IDs de ChatAttachment desse turn (passados pelo route.ts). loadContext
   *  node carrega cada um, roda Sentinel.quarantineAttachment, e compõe
   *  `attachmentBlock` apenas com os que passaram. */
  attachmentIds?: string[];

  /** Classificação feita pelo node `router`. Undefined antes do router rodar. */
  intent?: "informational" | "edit_simple" | "edit_multi" | "review" | "propose";

  /** Mesma shape do `AgentContext` legacy — populado por `loadContext` node. */
  contractContext?: AgentContext;

  /** F4 iteração 2026-05-17 — estado de assinatura do deal. Populado pelo
   *  loadContext node. Editor lê pra decidir entre `edit_contract_section`
   *  (draft) e `generateAddendumForDeal` (assinado). */
  signingState?: {
    hasSignedContract: boolean;
    signedAt: Date | null;
    signedDocumentUrl: string | null;
    originalContractId: string | null;
    envelopeId: string | null;
  };

  // `expertContext` saiu do state em 2026-07-31: era carregado uma vez, sem
  // agente definido, e por isso escapava do escopo de RAG. Agora cada
  // especialista carrega o seu (`expertContextFor`) e o preâmbulo nunca é
  // compartilhado entre agentes com escopos diferentes.

  /** Texto extraído de anexos do turn, já validado pelo Sentinel.
   *  Se Sentinel quarentinou, vem `undefined`. */
  attachmentBlock?: string;

  /** Outputs de cada especialista. Reducer faz merge por chave. */
  specialistOutputs: Partial<Record<SpecialistName, SpecialistOutput>>;

  /** Resposta final montada pelo aggregator node (markdown literal regra 10). */
  finalMessage?: string;

  /** Eventos acumulados pra rehidratar UI + persistir em `ChatMessage.events`. */
  events: AgentEvent[];

  /** Agregação de tokens/custo por especialista pra `recordAIUsage`. */
  usage: UsageAgg;
}

export type SpecialistName = "analyst" | "legal" | "editor" | "curator";

export interface SpecialistOutput {
  text: string;
  toolCalls: ToolCallRecord[];
  /** Quando o Sentinel rejeitou a invocação do especialista. */
  blockedByPolicy?: { ruleId: string; reason: string };
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  success: boolean;
  summary: string;
  /** Snapshot do doc antes da tool de write (lógica de agent.ts:589-624). */
  htmlBefore?: string;
  htmlAfter?: string;
  /** Output cru do handler quando o graph node precisa do payload completo
   *  (ex: propose_plan retorna `planId` + `steps` pra emitir plan_proposed
   *  event). Usado seletivamente — não popula em tools de read genéricas pra
   *  evitar inflar checkpoints. */
  rawResult?: Record<string, unknown>;
}

export interface UsageAgg {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  byAgent: Partial<Record<SpecialistName | "orchestrator" | "sentinel", number>>;
}

export function initialState(params: {
  contractId: string;
  userId: string;
  orgId: string;
  sessionId: string;
  userMessage: string;
  mode: AgentMode;
}): OrchestratorState {
  return {
    ...params,
    specialistOutputs: {},
    events: [],
    usage: {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 0,
      byAgent: {},
    },
  };
}

/** Re-exporta tipos auxiliares pra outros módulos não precisarem importar `types.ts` direto. */
export type { AgentEvent, AgentMode, PlanStep };
