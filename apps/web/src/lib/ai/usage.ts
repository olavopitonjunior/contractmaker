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
  // Candidatos avaliados para o OCR (tabela oficial em 2026-08-24). O preço de
  // output do Google é "including thinking tokens" — ver `geminiUsageToTokens`,
  // que soma `thoughtsTokenCount` ao completion antes de chegar aqui.
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  // Gemma é free-of-charge na API do Gemini e NÃO tem tier pago. Zero aqui é o
  // preço real, declarado de propósito: sem a entrada, `calcCostUsd` também
  // devolveria 0, mas por buraco na tabela, e o warn dele sumiria junto — os
  // dois zeros são indistinguíveis na coluna de custo.
  //
  // ⚠️ "Sem tier pago" NÃO significa "sem política de dados": os termos do
  // Gemini definem Paid Service pelo PROJETO Cloud da chave, não pelo modelo
  // ("a Paid Service only when accessing the API through a Cloud Project
  // associated with an active billing account"). Numa chave de projeto sem
  // billing, prompt e resposta viram material de treino com revisão humana —
  // o que, num pipeline que lê CPF e RG, é problema de LGPD, não de custo.
  // Confirmar o billing do projeto da chave ANTES de apontar OCR para Gemma.
  "gemma-4-31b-it": { input: 0, output: 0 },
  "gemma-4-26b-a4b-it": { input: 0, output: 0 },
  // Voyage AI — embeddings (input-only)
  "voyage-law-2": { input: 0.12, output: 0 },
  "voyage-3": { input: 0.06, output: 0 },
};

/**
 * `usageMetadata` do SDK `@google/genai`. `thoughtsTokenCount` só aparece em
 * modelos que raciocinam; os demais omitem o campo.
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface GeminiTokenCounts {
  promptTokens: number;
  completionTokens: number;
  /** Parte do completion que foi raciocínio. Faturada, mas invisível na resposta. */
  thoughtsTokens: number;
}

/**
 * Traduz o `usageMetadata` do Gemini para os campos de `AIUsage`.
 *
 * **Por que isto existe:** todos os call-sites do Gemini gravavam
 * `completionTokens: candidatesTokenCount`, ignorando `thoughtsTokenCount`.
 * Mas o Google fatura raciocínio como output — a tabela de preços diz
 * literalmente "Output price (including thinking tokens)" — e os dois campos
 * são separados. Medido numa matrícula no `gemini-2.5-flash`: 65 candidates
 * contra 312 thoughts, ou seja, o painel reportava ~1/5 do custo de output real.
 *
 * **O cache é deixado DENTRO de `promptTokens` de propósito.** `promptTokenCount`
 * já inclui `cachedContentTokenCount`, e seria tentador separá-lo para cobrar
 * na faixa de cacheRead — mas nenhuma entrada Gemini do `PRICING` define
 * `cacheRead`, e `calcCostUsd` faz `cacheReadTokens * (p.cacheRead ?? 0)`.
 * Separar sem a taxa faria o token cacheado custar ZERO, trocando a
 * subcontagem do output por uma subcontagem da entrada — o mesmo erro, do
 * outro lado. Mantê-lo no prompt cobra a taxa cheia: superestima um pouco
 * (o cache do Gemini custa ~10% do input), e superestimar é o lado seguro.
 * Separar de verdade exige as taxas na tabela e é trabalho para outro PR;
 * até lá `totalTokens` também mantém a semântica de hoje, o que importa
 * porque `lib/ai/budget.ts` soma essa coluna contra o teto por contrato.
 */
export function geminiUsageToTokens(
  usage: GeminiUsageMetadata | undefined,
  model?: string
): GeminiTokenCounts {
  const prompt = usage?.promptTokenCount ?? 0;
  const candidates = usage?.candidatesTokenCount ?? 0;
  const thoughts = usage?.thoughtsTokenCount ?? 0;

  // Identidade observada em todas as sondas: total = prompt + candidates +
  // thoughts. Se o Google mudar isso, é melhor descobrir por log do que por
  // fatura — este é exatamente o modo de falha que o bug original teve.
  const total = usage?.totalTokenCount;
  if (total != null && total !== prompt + candidates + thoughts) {
    console.warn(
      `[usage] soma de tokens do Gemini nao bate${model ? ` (${model})` : ""}: ` +
        `total=${total} prompt=${prompt} candidates=${candidates} thoughts=${thoughts}`
    );
  }

  return {
    promptTokens: prompt,
    completionTokens: candidates + thoughts,
    thoughtsTokens: thoughts,
  };
}

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
  | "max_chat"
  // Áudio ou imagem que chegou ao Max por WhatsApp, transcrito aqui. Roda neste
  // repo de propósito: a chave do Gemini e o painel de custo já vivem aqui, e o
  // serviço do Max não precisa de mais um segredo pra girar.
  | "max_transcribe";

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
  /**
   * Parte de `completionTokens` que foi raciocínio (Gemini `thoughtsTokenCount`,
   * Anthropic thinking). Já está DENTRO de `completionTokens` — vem separado só
   * para o painel conseguir responder "quanto do custo é o modelo pensando?".
   * Não somar de novo no total.
   */
  thoughtsTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  latencyMs: number;
  toolsUsed?: string[];
  iterations?: number;
  success?: boolean;
  errorMessage?: string;
  /**
   * Crédito REAL cobrado pelo provedor, quando ele informa. Hoje só o
   * OpenRouter informa (`usage.cost` na resposta), e é o Max quem repassa.
   *
   * Quando vem, SOBREPÕE a tabela de preços e a linha nasce
   * `costSource: "reported"`. Quando não vem, `calcCostUsd` entra e a linha é
   * `"estimated"`.
   *
   * **`null` e `undefined` significam "não informado"; zero NÃO.** Zero é um
   * número, e um número errado é pior que a ausência — uma chamada que de fato
   * custou zero é indistinguível de uma que ninguém mediu, e a segunda tem que
   * cair na estimativa.
   */
  costUsd?: number | null;
}

/** De onde veio o número em `estimatedCostUsd`. */
export type CostSource = "reported" | "estimated";

/**
 * Resume a procedência do custo a partir de um `groupBy(["costSource"])`.
 *
 * **Recebe o groupBy, e não as linhas, de propósito.** A primeira versão desta
 * função somava as linhas já carregadas pelo painel — que vêm com `take: 5000`.
 * Numa org movimentada, a parte MEDIDA (os turns do Max, a fonte de maior
 * volume) era truncada em silêncio, enquanto a tabela por provider na mesma
 * tela vinha de um `groupBy` sem teto. As duas discordariam sem nenhum aviso,
 * justamente numa linha que o usuário lê como sinal de confiança.
 *
 * Função pura e exportada porque é a única lógica do painel de custo que pode
 * errar em silêncio; testar pela rota exigiria mockar sete queries paralelas.
 *
 * `Number(...)` porque o Prisma devolve `Decimal`, e somar Decimal com `+`
 * daria concatenação de string.
 */
export function dividirPorProcedencia(
  grupos: Array<{
    costSource?: string | null;
    _sum?: { estimatedCostUsd?: unknown };
    _count?: { _all?: number } | number;
  }>
): {
  reportedUsd: number;
  estimatedUsd: number;
  reportedCalls: number;
  estimatedCalls: number;
} {
  let reportedUsd = 0;
  let estimatedUsd = 0;
  let reportedCalls = 0;
  let estimatedCalls = 0;

  for (const g of grupos) {
    const v = Number(g._sum?.estimatedCostUsd ?? 0);
    const custo = Number.isFinite(v) ? v : 0;
    const n =
      typeof g._count === "number" ? g._count : Number(g._count?._all ?? 0);
    const calls = Number.isFinite(n) ? n : 0;

    // Só `"reported"` conta como medido. Linha antiga (anterior à coluna) tem
    // o default `"estimated"`, e `null`/valor desconhecido cai no mesmo lado —
    // na dúvida sobre a procedência, o honesto é chamar de estimativa.
    if (g.costSource === "reported") {
      reportedUsd += custo;
      reportedCalls += calls;
    } else {
      estimatedUsd += custo;
      estimatedCalls += calls;
    }
  }

  /**
   * SEIS casas, não quatro — e a diferença não é cosmética.
   *
   * O resto do painel arredonda em 4 porque exibe 2. Esta linha exibe **6**
   * (`formatUsdPreciso`), justamente porque um turn do Max custa ~US$ 0,0004 e
   * medido × estimado precisam ficar distinguíveis. Cortando em 4 aqui, as
   * duas últimas casas do formatador viram decoração: US$ 0,00010614 chegava
   * na tela como `$ 0,000100`, e `$ 0,000106` era inalcançável por construção.
   *
   * Achado no smoke de 22/08, olhando o número renderizado em vez de aceitar
   * que "a linha apareceu".
   */
  return {
    reportedUsd: Number(reportedUsd.toFixed(6)),
    estimatedUsd: Number(estimatedUsd.toFixed(6)),
    reportedCalls,
    estimatedCalls,
  };
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

  /**
   * Medido vence calculado. `calcCostUsd` só roda quando não há número do
   * provedor — não é fallback preguiçoso, é a ordem certa: a tabela de preços
   * é uma boa aproximação do preço unitário e não tem como saber quanto do
   * prompt veio do cache, que é onde mora o erro de 304%.
   *
   * `Number.isFinite` cerca NaN/Infinity: uma resposta malformada do provedor
   * não pode virar um Decimal quebrado numa coluna que alimenta budget.
   */
  const reportado =
    params.costUsd != null && Number.isFinite(params.costUsd) && params.costUsd >= 0
      ? params.costUsd
      : null;
  const costSource: CostSource = reportado !== null ? "reported" : "estimated";
  const cost =
    reportado ??
    calcCostUsd(params.model, params.promptTokens, completion, cacheRead, cacheWrite);
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
        thoughtsTokens: params.thoughtsTokens ?? 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: total,
        estimatedCostUsd: cost,
        costSource,
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
