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
import {
  assertContractBudget,
  assertAgentBudget,
  AgentBudgetExceededError,
  ContractBudgetExceededError,
  OrgAiBudgetExceededError,
} from "../budget";
import type { ResolvedAgentProfile } from "../agents/resolve";
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

/** Troca de modelo por sobrecarga (429/529) — ver `anthropic-client.ts`. */
interface FallbackInfo {
  from: string;
  to: string;
  reason: string;
}

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
  /**
   * Força uma tool ESPECÍFICA na 1ª chamada (`tool_choice: {type:"tool"}`).
   * Tem precedência sobre `forceToolUse`. Usado pelo modo Planejar: o Editor
   * é obrigado a chamar `propose_plan` antes de qualquer write — enforcement
   * determinístico, não dependente do prompt.
   */
  forceToolName?: string;
  /** Pre-check Sentinel (passado pelo Editor/Curator; Analyst/Legal não precisam). */
  toolGuard?: ToolUseGuard;
  /** Quando true, captura htmlBefore/htmlAfter em edits (GDocs). */
  captureSnapshots?: boolean;
  /** F5: propose_plan e outros writes que precisam linkar ChatPlan/ChatMessage
   *  exigem sessionId no AgentContext. Quando passado, o runner injeta sessionId
   *  + pendingAssistantMessageId na cópia local do context antes de cada
   *  tool dispatch. */
  sessionId?: string;
  /**
   * Perfil já resolvido pelo especialista (org → plataforma → hardcoded).
   * O `systemPrompt` recebido JÁ inclui as instruções — o perfil vem junto
   * porque temperature/maxTokens também saem dele.
   */
  profile?: ResolvedAgentProfile;
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
    forceToolName,
  } = config;

  // Modelo que REALMENTE rodou ESTE turn. Um run multi-turn pode atravessar
  // modelos: o fallback vale só pro turn que pegou o 429/529, e o seguinte volta
  // ao primário. Somar tudo num bucket só e precificar no último modelo cobra os
  // tokens do Sonnet a preço de Haiku (ou o contrário) — e esse número alimenta
  // os DOIS tetos e o painel.
  let turnModel = model;
  const perModel = new Map<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      turns: number;
    }
  >();
  function addTurnUsage(
    m: string,
    u: { input: number; output: number; cacheRead: number; cacheWrite: number }
  ) {
    const acc = perModel.get(m) ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: 0,
    };
    acc.promptTokens += u.input;
    acc.completionTokens += u.output;
    acc.cacheReadTokens += u.cacheRead;
    acc.cacheWriteTokens += u.cacheWrite;
    acc.turns += 1;
    perModel.set(m, acc);
  }

  /**
   * A tentativa QUE FALHOU vira linha na hora em que o fallback dispara, não no
   * fim do run. Se o modelo de contingência também estourar, o erro sobe e
   * qualquer registro colocado depois do loop nunca roda — sumindo justamente o
   * caso em que mais se quer saber que a contingência foi tentada.
   */
  const onFallback = (info: FallbackInfo) => {
    turnModel = info.to;
    recordAIUsage({
      orgId,
      userId,
      contractId,
      sessionId: config.sessionId ?? null,
      dealId: context.dealId ?? null,
      provider: "anthropic",
      model: info.from,
      operation: `specialist_${agentName}` as AIOperation,
      agentKey: agentName,
      promptTokens: 0,
      latencyMs: 0,
      success: false,
      errorMessage: `sobrecarga (${info.reason}) — turn seguiu em ${info.to}`,
    });
  };

  // Budget guard antes da 1ª chamada. O teto POR AGENTE vem primeiro: ele é o
  // mais específico, e a mensagem dele diz qual agente parou — "o Editor
  // atingiu o teto" resolve, "a IA atingiu o teto" manda o usuário adivinhar.
  try {
    await assertAgentBudget(orgId, agentName);
    await assertContractBudget(contractId);
  } catch (err) {
    // Ordem das subclasses importa: as três descendem de
    // ContractBudgetExceededError, então a mais específica tem que ser
    // testada primeiro ou a mensagem certa nunca chega ao usuário.
    if (err instanceof AgentBudgetExceededError) {
      return { text: `⚠️ ${err.message}`, toolCalls: [] };
    }
    // Org-level (USD): a mensagem carrega o remédio certo (Config → Uso de
    // IA) — checar a subclasse ANTES do contrato.
    if (err instanceof OrgAiBudgetExceededError) {
      return { text: `⚠️ ${err.message}`, toolCalls: [] };
    }
    if (err instanceof ContractBudgetExceededError) {
      return {
        text: `⚠️ Budget de IA atingido neste contrato. Não foi possível executar o ${agentName}.`,
        toolCalls: [],
      };
    }
    throw err;
  }

  // O system prompt já chega completo do especialista (base por-domínio +
  // instruções de plataforma + instruções do tenant, via composeSystemPrompt).
  // Antes o runner buscava as instruções do tenant por conta própria — virou
  // responsabilidade de quem resolve o perfil, pra não haver duas fontes.
  // O cache_control segue efetivo: o prompt é por-org, mas estável entre turns.
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
    // Perfil do agente sobrescreve os defaults do runner quando definido.
    max_tokens: config.profile?.maxTokens ?? 2048,
    temperature: config.profile?.temperature ?? 0.3,
    system: systemBlocks,
    tools,
    // tool_choice nomeado vence o "any": em modo Planejar o Editor precisa
    // cair em propose_plan, não em qualquer tool.
    ...(forceToolName
      ? { tool_choice: { type: "tool" as const, name: forceToolName } }
      : forceToolUse
        ? { tool_choice: { type: "any" as const } }
        : {}),
    messages,
    stream: true,
  };

  let turnResult;
  try {
    // Generator yields text_delta mas descartamos (especialista não fala direto).
    // Contingência de sobrecarga: o `fallbackModel` do perfil existe desde o
    // console de agentes e até aqui ninguém o consumia.
    const gen = streamOneTurn(firstParams, {
      fallbackModel: config.profile?.fallbackModel,
      onFallback,
    });
    let it = await gen.next();
    while (!it.done) it = await gen.next();
    turnResult = it.value;
  } catch (err) {
    recordAIUsage({
      orgId,
      userId,
      contractId,
      sessionId: config.sessionId ?? null,
      dealId: context.dealId ?? null,
      provider: "anthropic",
      // O modelo que REALMENTE falhou. Com `model` cru, um erro no fallback
      // apareceria atribuído ao primário.
      model: turnModel,
      operation: `specialist_${agentName}` as AIOperation,
      agentKey: agentName,
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
  addTurnUsage(turnModel, turnResult.usage);

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
      // `agentKey` vai sempre: é o que dá escopo de RAG por agente às tools de
      // consulta (`knowledge-scope.ts`). Os 4 especialistas têm o mesmo nome no
      // registry de agentes, então `agentName` serve direto.
      const handlerContext = {
        ...context,
        agentKey: agentName,
        ...(config.sessionId
          ? {
              sessionId: config.sessionId,
              pendingAssistantMessageId:
                context.pendingAssistantMessageId ??
                `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            }
          : {}),
      };

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
      max_tokens: config.profile?.maxTokens ?? 2048,
      temperature: config.profile?.temperature ?? 0.3,
      system: systemBlocks,
      tools,
      messages,
      stream: true,
    };

    try {
      turnModel = model;
      const gen = streamOneTurn(nextParams, {
        fallbackModel: config.profile?.fallbackModel,
        onFallback,
      });
      let it = await gen.next();
      while (!it.done) it = await gen.next();
      turnResult = it.value;
    } catch (err) {
      recordAIUsage({
        orgId,
        userId,
        contractId,
        sessionId: config.sessionId ?? null,
        dealId: context.dealId ?? null,
        provider: "anthropic",
        model: turnModel,
        operation: `specialist_${agentName}` as AIOperation,
        agentKey: agentName,
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
    addTurnUsage(turnModel, turnResult.usage);
  }

  // Uma linha POR MODELO que rodou. Quase sempre é uma só; passam a ser duas
  // quando o fallback de sobrecarga entrou no meio do run, e aí cada metade é
  // precificada na tabela certa. `latencyMs` é do run inteiro e vai na primeira
  // linha — reparti-lo entre modelos seria inventar medição.
  let primeira = true;
  for (const [m, acc] of perModel) {
    recordAIUsage({
      orgId,
      userId,
      contractId,
      sessionId: config.sessionId ?? null,
      dealId: context.dealId ?? null,
      provider: "anthropic",
      model: m,
      operation: `specialist_${agentName}` as AIOperation,
      agentKey: agentName,
      promptTokens: acc.promptTokens,
      completionTokens: acc.completionTokens,
      cacheReadTokens: acc.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens,
      latencyMs: primeira ? Date.now() - t0 : 0,
      toolsUsed: primeira ? Array.from(toolsUsedSet) : [],
      iterations: acc.turns,
      success: true,
    });
    primeira = false;
  }

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
