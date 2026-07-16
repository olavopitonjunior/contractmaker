/**
 * Runner genérico de especialista. Encapsula o loop tool-use com:
 *   - cache_control ephemeral no system prompt
 *   - streamOneTurn pra capturar tokens corretamente
 *   - assertContractBudget antes de cada chamada à API
 *   - recordAIUsage agregado (operation: "specialist_<agent>")
 *   - max iterations configurável (Analyst/Legal: 2; Editor: 3)
 *
 * Usa as mesmas regras de tool dispatch do agent.ts legacy, mas:
 *   - NÃO yield text_delta pro stream final (especialistas não falam direto
 *     com o usuário — o aggregator fala)
 *   - NÃO persiste ChatMessage/ChangeLog (responsabilidade do orquestrador)
 *   - Retorna SpecialistOutput sintético pro reducer do graph
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { streamOneTurn } from "./turn";
import { executeToolHandler } from "../tool-handlers";
import { mapToolToAction, summarizeToolResult, type ToolOutput } from "./tool-mapping";
import { capturePreSnapshot, capturePostSnapshot } from "./snapshot";
import { recordAIUsage, type AIOperation } from "../usage";
import { assertContractBudget, ContractBudgetExceededError } from "../budget";
import type { AgentContext } from "../types";
import type {
  SpecialistName,
  SpecialistOutput,
  ToolCallRecord,
} from "../orchestrator/state";

/**
 * Hook chamado ANTES de cada tool_use. Retorna `{ allowed: false, reason }`
 * pra bloquear (Sentinel). Default: tudo permitido.
 */
export type ToolUseGuard = (
  toolCall: { name: string; input: Record<string, unknown> }
) => Promise<{ allowed: true } | { allowed: false; reason: string; ruleId?: string }>;

export interface SpecialistRunnerConfig {
  agentName: SpecialistName;
  model: string;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  maxIterations: number;
  /** Prompt do usuário JÁ composto (expert context + dataJson md + html + msg). */
  userPrompt: string;
  /** Context completo do contrato — necessário pros tool handlers. */
  context: AgentContext;
  contractId: string;
  orgId: string;
  userId: string;
  /** Quando true, força o LLM a chamar pelo menos 1 tool. */
  forceToolUse?: boolean;
  /** Pre-check Sentinel (passado pelo Editor/Curator; Analyst/Legal não precisam). */
  toolGuard?: ToolUseGuard;
  /** Quando true, captura htmlBefore/htmlAfter em edits (GDocs). */
  captureSnapshots?: boolean;
  /** F5: propose_plan e outros writes que precisam linkar ChatPlan/ChatMessage
   *  exigem sessionId no AgentContext. Quando passado, o runner injeta sessionId
   *  + pendingAssistantMessageId na cópia local do context antes de cada
   *  tool dispatch. */
  sessionId?: string;
}

export async function runSpecialist(
  config: SpecialistRunnerConfig
): Promise<SpecialistOutput> {
  const {
    agentName,
    model,
    systemPrompt,
    tools,
    maxIterations,
    userPrompt,
    context,
    contractId,
    orgId,
    userId,
    forceToolUse,
  } = config;

  // Budget guard antes da 1ª chamada
  try {
    await assertContractBudget(contractId);
  } catch (err) {
    if (err instanceof ContractBudgetExceededError) {
      return {
        text: `⚠️ Budget de IA atingido neste contrato. Não foi possível executar o ${agentName}.`,
        toolCalls: [],
      };
    }
    throw err;
  }

  const systemBlocks = [
    {
      type: "text" as const,
      text: systemPrompt,
      cache_control: { type: "ephemeral" as const },
    },
  ] as unknown as Anthropic.TextBlockParam[];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const toolsUsedSet = new Set<string>();
  const usageAgg = {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let iterations = 0;
  const t0 = Date.now();

  // 1ª chamada
  const firstParams: Anthropic.MessageCreateParamsStreaming = {
    model,
    max_tokens: 2048,
    temperature: 0.3,
    system: systemBlocks,
    tools,
    ...(forceToolUse ? { tool_choice: { type: "any" as const } } : {}),
    messages,
    stream: true,
  };

  let turnResult;
  try {
    // Generator yields text_delta mas descartamos (especialista não fala direto).
    const gen = streamOneTurn(firstParams);
    let it = await gen.next();
    while (!it.done) it = await gen.next();
    turnResult = it.value;
  } catch (err) {
    recordAIUsage({
      orgId,
      userId,
      contractId,
      provider: "anthropic",
      model,
      operation: `specialist_${agentName}` as AIOperation,
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  usageAgg.promptTokens += turnResult.usage.input;
  usageAgg.completionTokens += turnResult.usage.output;
  usageAgg.cacheReadTokens += turnResult.usage.cacheRead;
  usageAgg.cacheWriteTokens += turnResult.usage.cacheWrite;

  while (turnResult.stopReason === "tool_use" && iterations < maxIterations) {
    iterations++;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of turnResult.contentBlocks) {
      if (block.type !== "tool_use") continue;
      toolsUsedSet.add(block.name);

      const input = block.input as Record<string, unknown>;

      // Sentinel pre-check (Editor/Curator passam toolGuard; Analyst/Legal não).
      if (config.toolGuard) {
        const guardResult = await config.toolGuard({ name: block.name, input });
        if (!guardResult.allowed) {
          const reason = `Bloqueado por policy${guardResult.ruleId ? ` (${guardResult.ruleId})` : ""}: ${guardResult.reason}`;
          toolCalls.push({
            name: block.name,
            input,
            success: false,
            summary: reason,
            blockedByPolicy: {
              ruleId: guardResult.ruleId ?? "unknown",
              reason: guardResult.reason,
            },
          } as ToolCallRecord & { blockedByPolicy: { ruleId: string; reason: string } });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: reason, blockedByPolicy: true }),
            is_error: true,
          });
          continue;
        }
      }

      const htmlBefore = config.captureSnapshots
        ? await capturePreSnapshot(block.name, context)
        : undefined;

      // F5: pre-popula context com sessionId + pendingAssistantMessageId
      // pra handlers que dependem disso (propose_plan, suggestions vinculadas).
      const handlerContext = config.sessionId
        ? {
            ...context,
            sessionId: config.sessionId,
            pendingAssistantMessageId:
              context.pendingAssistantMessageId ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }
        : context;

      let result: ToolOutput;
      try {
        result = (await executeToolHandler(
          block.name,
          input,
          handlerContext
        )) as ToolOutput;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[specialist:${agentName}] tool ${block.name} threw:`, err);
        result = { error: `Tool ${block.name} falhou: ${msg.slice(0, 200)}` };
      }

      const htmlAfter = config.captureSnapshots
        ? await capturePostSnapshot(block.name, context, result, htmlBefore)
        : undefined;

      // B3 (2026-05): realimenta o resultado de VERIFICAÇÃO ao LLM para tools
      // cujo propósito é mutar o texto visível do doc. Se o snapshot mostra que
      // o doc NÃO mudou, injetamos `verified:false` no tool_result — assim o
      // Editor enxerga que a edição não pegou e pode reagir (auto-retry, B4),
      // em vez de declarar sucesso. Escopo restrito: add_comment/
      // update_contract_data/propose_* não mudam o texto e ficariam falso-negativos.
      const DOC_MUTATING = new Set([
        "edit_contract_section",
        "insert_clause",
        "remove_clause",
      ]);
      if (
        DOC_MUTATING.has(block.name) &&
        htmlBefore !== undefined &&
        htmlAfter !== undefined &&
        !result.error
      ) {
        const changed = htmlBefore !== htmlAfter;
        (result as Record<string, unknown>).verified = changed;
        if (!changed) {
          (result as Record<string, unknown>).appliedToDoc = false;
          (result as Record<string, unknown>).hint =
            "A releitura do documento NÃO confirmou a mudança — o texto continua igual. " +
            "Provavelmente o `target` não casou exatamente. Tente novamente com um trecho " +
            "mais específico (copie o texto exato do documento) ou ajuste a abordagem.";
        }
      }

      const success = !result.error;
      const summary = summarizeToolResult(block.name, result);

      // F5: propose_plan precisa de planId+steps no graph editorNode pra
      // emitir plan_proposed event. Popula rawResult seletivamente.
      const rawResult =
        block.name === "propose_plan" && success
          ? (result as Record<string, unknown>)
          : undefined;

      toolCalls.push({
        name: block.name,
        input,
        success,
        summary,
        htmlBefore,
        htmlAfter,
        rawResult,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "assistant", content: turnResult.contentBlocks });
    messages.push({ role: "user", content: toolResults });

    if (iterations >= maxIterations) break;

    const nextParams: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: systemBlocks,
      tools,
      messages,
      stream: true,
    };

    try {
      const gen = streamOneTurn(nextParams);
      let it = await gen.next();
      while (!it.done) it = await gen.next();
      turnResult = it.value;
    } catch (err) {
      recordAIUsage({
        orgId,
        userId,
        contractId,
        provider: "anthropic",
        model,
        operation: `specialist_${agentName}` as AIOperation,
        promptTokens: usageAgg.promptTokens,
        completionTokens: usageAgg.completionTokens,
        cacheReadTokens: usageAgg.cacheReadTokens,
        cacheWriteTokens: usageAgg.cacheWriteTokens,
        latencyMs: Date.now() - t0,
        toolsUsed: Array.from(toolsUsedSet),
        iterations,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    usageAgg.promptTokens += turnResult.usage.input;
    usageAgg.completionTokens += turnResult.usage.output;
    usageAgg.cacheReadTokens += turnResult.usage.cacheRead;
    usageAgg.cacheWriteTokens += turnResult.usage.cacheWrite;
  }

  recordAIUsage({
    orgId,
    userId,
    contractId,
    provider: "anthropic",
    model,
    operation: `specialist_${agentName}` as AIOperation,
    promptTokens: usageAgg.promptTokens,
    completionTokens: usageAgg.completionTokens,
    cacheReadTokens: usageAgg.cacheReadTokens,
    cacheWriteTokens: usageAgg.cacheWriteTokens,
    latencyMs: Date.now() - t0,
    toolsUsed: Array.from(toolsUsedSet),
    iterations: iterations + 1,
    success: true,
  });

  let text = "";
  for (const block of turnResult.contentBlocks) {
    if (block.type === "text") {
      text += block.text;
    }
  }

  // Marca actions no map (uso futuro pelo Aggregator + audit)
  void mapToolToAction;

  return { text, toolCalls };
}
