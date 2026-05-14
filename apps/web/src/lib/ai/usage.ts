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
  // Anthropic — Claude 4 family
  "claude-opus-4-20250514": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Google Gemini
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
  if (!p) return 0;
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

export type AIProvider = "anthropic" | "gemini" | "voyage";

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
  | "voice_extract";

export interface RecordUsageParams {
  orgId: string;
  userId?: string | null;
  contractId?: string | null;
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

  void prisma.aIUsage
    .create({
      data: {
        orgId: params.orgId,
        userId: params.userId ?? null,
        contractId: params.contractId ?? null,
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
    .catch((err) => {
      console.error("[recordAIUsage] failed to persist:", err);
    });
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
