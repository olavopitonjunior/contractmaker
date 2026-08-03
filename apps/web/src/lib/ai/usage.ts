/**
 * AI usage observability helper.
 *
 * Captures every AI call (Anthropic, Gemini, Voyage) into the AIUsage table
 * with tokens, latency, cost and context metadata. Meant to be called
 * fire-and-forget: failures here must NEVER break the AI flow.
 *
 * Pricing is maintained here as the single source of truth. Update the table
 * below when provider prices change.
 */

import { prisma } from "@/lib/db/prisma";
import { waitUntil } from "@vercel/functions";
import { OPERATION_TO_AGENT, type AgentKey } from "./agents/registry";

// ────────────────────────────────────────────────────────────────────────────
// Pricing table — USD per 1,000,000 tokens.
// Last revised: 2026-04-14. Check https://anthropic.com/pricing,
// https://ai.google.dev/pricing and https://voyageai.com/pricing.
// ────────────────────────────────────────────────────────────────────────────

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Anthropic — família 4.6 (atual; revisado 2026-07-15)
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Anthropic — aposentados/deprecados (mantidos pra custo de AIUsage histórico)
  "claude-opus-4-20250514": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Google Gemini
  // OpenRouter — o que o Max e o Newton usam. Preço de tabela do provedor em
  // 2026-08-03 (US$ por 1M de tokens); conferir ao trocar de modelo, senão o
  // painel passa a mentir em silêncio, que é o modo de falha desta tabela.
  "openai/gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "openai/gpt-5.4-mini": { input: 0.75, output: 4.5 },

  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  // Voyage AI — embeddings (input-only)
  "voyage-law-2": { input: 0.12, output: 0 },
  "voyage-3": { input: 0.06, output: 0 },
};

export function calcCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const p = PRICING[model];
  if (!p) {
    // Modelo sem pricing → custo 0 silencioso mascarava gasto real (o Editor
    // rodava em claude-sonnet-4-6 e gravava $0). Loga pra buracos futuros
    // ficarem visíveis no lugar de sumirem.
    console.warn(`[usage] modelo sem pricing na tabela, custo=0: ${model}`);
    return 0;
  }
  const perToken = 1 / 1_000_000;
  return (
    promptTokens * p.input * perToken +
    completionTokens * p.output * perToken +
    cacheReadTokens * (p.cacheRead ?? 0) * perToken +
    cacheWriteTokens * (p.cacheWrite ?? 0) * perToken
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recording
// ────────────────────────────────────────────────────────────────────────────

/**
 * `openrouter` entrou quando o Max passou a rodar por lá, com o mesmo modelo do
 * Newton (`openai/gpt-5.4-nano`) por decisão de custo. Sem ele, o agente
 * externo teria que se declarar `anthropic` — e o painel mostraria um modelo
 * OpenAI atribuído à Anthropic.
 */
export type AIProvider = "anthropic" | "gemini" | "voyage" | "openrouter";

export type AIOperation =
  | "chat"
  | "passive_open"
  | "passive_edit"
  | "ocr_form"
  | "ocr_tool"
  | "embed_kb"
  | "embed_memory"
  | "embed_query"
  | "summarize_memory"
  | "clause_generate"
  | "doc_analysis"
  | "extract_ccv_doc"
  | "extract_locacao_doc"
  | "voice_extract"
  | "insights"
  | "assistant_chat"
  // Assistente de suporte ao usuário (widget flutuante + /admin/support-ai)
  | "support_chat"
  // Ingestão DOCX→template (engine google_docs): pass de IA que insere
  // {{placeholders}} no Doc-modelo da imobiliária.
  | "template_placeholder_insertion"
  // DIMOB — copiloto de revisão fiscal (one-shot Haiku)
  | "dimob_review"
  | "dimob_diagnose"
  | "dimob_explain"
  // Orquestrador multi-agente (caminho de chat default). Antes entravam como
  // `as never` em specialist-runner e sumiam de qualquer filtro por operação.
  | "specialist_analyst"
  | "specialist_legal"
  | "specialist_editor"
  | "specialist_curator"
  // Sentinel — classificador de policy (anti prompt-injection em anexos)
  | "sentinel_classify"
  // Classificador de intenção (fallback do orquestrador). Antes entrava como
  // `as never` em intent-fallback e sumia de qualquer filtro por operação.
  | "intent_classify"
  // Pesquisas de satisfação — resumo Haiku das respostas abertas de um lote
  | "survey_summary"
  // Ingestão da base de conhecimento — desempate template/cláusulas/acervo
  // quando a heurística determinística fica incerta (lib/knowledge/upload-classifier).
  | "knowledge_upload_classification"
  // Agente externo (Max, LangGraph fora deste repo) reportando o próprio turn
  // por `POST /api/agents/usage`. O custo dele roda em infra nossa e some do
  // painel se não voltar por aqui.
  | "max_chat";

export interface RecordUsageParams {
  /** `null` = custo de PLATAFORMA (base universal), sem tenant a quem atribuir. */
  orgId: string | null;
  /**
   * Agente responsável. Omitido, é derivado de `operation` pelo registry.
   * Passe explicitamente quando a operação for gravada por mais de um agente
   * (ver `AMBIGUOUS_OPERATIONS`) — `null` explícito significa "sem agente".
   */
  agentKey?: AgentKey | null;
  userId?: string | null;
  contractId?: string | null;
  /** ChatSession do turn (chat/specialists). Null em operações sem chat. */
  sessionId?: string | null;
  /** Deal associado à operação. Null quando não há negócio em escopo. */
  dealId?: string | null;
  provider: AIProvider;
  model: string;
  operation: AIOperation;
  promptTokens: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  latencyMs: number;
  toolsUsed?: string[];
  iterations?: number;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Fire-and-forget recording. Never throws — observability must not break the
 * AI flow. Errors are logged but swallowed.
 *
 * Usa `waitUntil` quando disponível (serverless Vercel): um `void promise()`
 * cru é cancelado quando a função congela após a resposta, perdendo a linha de
 * custo — o que também fura o budget guard que soma AIUsage. `waitUntil`
 * segura a execução até a escrita terminar.
 */
export function recordAIUsage(params: RecordUsageParams): void {
  const completion = params.completionTokens ?? 0;
  const cacheRead = params.cacheReadTokens ?? 0;
  const cacheWrite = params.cacheWriteTokens ?? 0;
  const total = params.promptTokens + completion;
  const cost = calcCostUsd(
    params.model,
    params.promptTokens,
    completion,
    cacheRead,
    cacheWrite
  );
  // Truncate error messages to avoid leaking large prompts or PII.
  const errorMessage = params.errorMessage
    ? params.errorMessage.slice(0, 500)
    : null;

  // Explícito vence a derivação; `undefined` (campo ausente) cai no registry.
  const agentKey =
    params.agentKey !== undefined
      ? params.agentKey
      : OPERATION_TO_AGENT[params.operation] ?? null;

  const write = prisma.aIUsage
    .create({
      data: {
        orgId: params.orgId,
        agentKey,
        userId: params.userId ?? null,
        contractId: params.contractId ?? null,
        sessionId: params.sessionId ?? null,
        dealId: params.dealId ?? null,
        provider: params.provider,
        model: params.model,
        operation: params.operation,
        promptTokens: params.promptTokens,
        completionTokens: completion,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: total,
        estimatedCostUsd: cost,
        latencyMs: params.latencyMs,
        toolsUsed: params.toolsUsed ?? [],
        iterations: params.iterations ?? 1,
        success: params.success ?? true,
        errorMessage,
      },
    })
    .then(() => undefined)
    .catch((err) => {
      console.error("[recordAIUsage] failed to persist:", err);
    });

  // Segura a escrita além da resposta (serverless). Fora da Vercel, waitUntil
  // não existe — cai no fire-and-forget puro.
  try {
    waitUntil(write);
  } catch {
    void write;
  }
}

/**
 * Convenience wrapper: starts a timer and returns a finalizer closure that
 * records the usage. Makes call sites cleaner:
 *
 *   const finish = startUsageTimer({ orgId, userId, operation: "chat", ... });
 *   const response = await anthropic.messages.create(...);
 *   finish({ promptTokens: response.usage.input_tokens, ... });
 */
export function startUsageTimer(
  base: Omit<RecordUsageParams, "latencyMs" | "promptTokens">
) {
  const t0 = Date.now();
  return (extra: {
    promptTokens: number;
    completionTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    toolsUsed?: string[];
    iterations?: number;
    success?: boolean;
    errorMessage?: string;
  }) => {
    recordAIUsage({
      ...base,
      ...extra,
      latencyMs: Date.now() - t0,
    });
  };
}
