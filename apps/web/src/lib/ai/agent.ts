import type { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { AGENT_TOOLS } from "./tools";
import { executeToolHandler } from "./tool-handlers";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "./prompts";
import { quickChecks, dedupeKeyFor, type QuickFinding } from "./quickChecks";
import { recordAIUsage } from "./usage";
import { assertContractBudget, ContractBudgetExceededError } from "./budget";
import { loadExpertContext } from "./expert-context";
import { getAnthropicClient, HAIKU_MODEL, SONNET_MODEL } from "./shared/anthropic-client";
import { loadContext } from "./shared/context";
import { resolveSession, loadChatHistory } from "./shared/session";
import { streamOneTurn, type StreamedTurnResult } from "./shared/turn";
import {
  EDIT_TOOL_NAMES,
  isEditTool,
  mapToolToAction,
  buildToolSummary,
  summarizeToolResult,
  type ToolOutput,
} from "./shared/tool-mapping";
import type {
  AgentEvent,
  AgentMode,
  AgentResult,
  ChangeLogEntry,
  PlanStep,
} from "./types";

const anthropic = getAnthropicClient();

interface AgentParams {
  message: string;
  contractId: string;
  userId: string;
  orgId: string;
  /** Modo do agente. Default 'plan' (multi-turn com expert context). */
  mode?: AgentMode;
  /** Session específica pra continuar. Se omitido, usa a última não-arquivada
   *  ou cria uma nova. UI passa explicitamente quando há múltiplas sessions. */
  sessionId?: string;
  /** IDs de ChatAttachment a anexar nesse turn — extractedText vai como
   *  prefixo no prompt do user. Limitado pelo TEXT_CAP per-attachment já
   *  aplicado no upload. */
  attachmentIds?: string[];
}

async function getAgentConfig(orgId: string, mode: AgentMode) {
  const config = await prisma.agentConfig.findUnique({ where: { orgId } });

  // Resolução de modelo por modo:
  // - fast: SEMPRE Haiku (sobrepõe AgentConfig.model). Otimizado pra latência.
  // - plan: respeita AgentConfig.model > ANTHROPIC_MODEL env > default Sonnet
  //   (raciocínio mais profundo justifica o custo 3× maior).
  let model: string;
  if (mode === "fast") {
    model = HAIKU_MODEL;
  } else {
    model = config?.model || process.env.ANTHROPIC_MODEL || SONNET_MODEL;
  }

  return {
    model,
    temperature: config?.temperature ?? 0.3,
    maxTokens: config?.maxTokens ?? 4096,
    systemPrompt: config?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  };
}

// Helpers (loadContext, resolveSession, loadChatHistory, streamOneTurn,
// mapToolToAction, buildToolSummary, summarizeToolResult, EDIT_TOOL_NAMES,
// isEditTool, ToolOutput, StreamedTurnResult) extraídos pra `./shared/*` em
// F1 da arquitetura multi-agente. Especialistas (analyst, legal, editor,
// curator) reusam esses módulos sem duplicar lógica.

/**
 * @deprecated F5 (2026-05-16) — o caminho legado de chat single-agent está
 * obsoleto. Todo chat de contrato roteia pelo `runOrchestrator` do graph
 * multi-agente (`orchestrator/graph.ts`). Esta função permanece exportada
 * apenas pra:
 *   1. `runPassiveAnalysis` (análise automática open/edit/approve — não
 *      migrada por enquanto, vive na mesma module).
 *   2. `/api/contracts/[id]/comments/[commentId]/ai-resolve` (legacy path
 *      planejado pra migrar em F6).
 *
 * NÃO use em novos endpoints — chame `runOrchestrator` diretamente.
 *
 * Roda o agente em modo streaming, emitindo eventos AgentEvent durante o
 * loop tool-use. Cada chamada à API Anthropic é streamed e cada tool
 * dispatch é anunciado antes (tool_use) e depois (tool_result + opcionalmente
 * verification).
 *
 * O último evento é sempre `done` (com AgentResult completo) ou `error`.
 */
export async function* streamContractAgent(
  params: AgentParams
): AsyncGenerator<AgentEvent, void, void> {
  const mode: AgentMode = params.mode ?? "plan";
  const events: AgentEvent[] = [];

  try {
    // 1. Check contract status
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: params.contractId },
    });

    if (contract.status === "aprovado") {
      const done: AgentEvent = {
        type: "done",
        result: {
          message:
            "⚠️ Este contrato já foi aprovado e não pode mais ser alterado. Para modificações, crie uma nova versão a partir do deal.",
          htmlContent: null,
          dataJson: null,
          changeLogs: [],
          events: [],
        },
      };
      yield done;
      return;
    }

    // 1.5. Budget guard
    try {
      await assertContractBudget(params.contractId);
    } catch (err) {
      if (err instanceof ContractBudgetExceededError) {
        const done: AgentEvent = {
          type: "done",
          result: {
            message: `⚠️ ${err.message}\n\nApós aprovar este contrato (ou ajustar a env \`CONTRACT_AI_TOKEN_BUDGET\`) o assistente volta a responder.`,
            htmlContent: null,
            dataJson: null,
            changeLogs: [],
            events: [],
          },
        };
        yield done;
        return;
      }
      throw err;
    }

    // 2. Config
    const config = await getAgentConfig(params.orgId, mode);

    // 3. Context
    const context = await loadContext(params.contractId, params.orgId);

    // 3.5. Expert context só em modo Plan. Fast pula pra cortar 200-500ms
    //      + 3 Prisma queries + Voyage call.
    let expertContext = "";
    if (mode === "plan") {
      try {
        expertContext = await loadExpertContext(context);
      } catch (err) {
        console.error("[streamContractAgent] loadExpertContext falhou (segue sem):", err);
      }
    }

    // 3.6. Resolve session (multi-session support). UI passa sessionId
    //      explicitamente; sem ela, usa a mais recente não-arquivada ou cria.
    const activeSession = await resolveSession(
      params.contractId,
      params.userId,
      params.sessionId
    );
    context.sessionId = activeSession.id;
    // Pre-aloca o ID da mensagem assistant — propose_plan precisa dele pra
    // gravar ChatPlan.messageId ANTES da msg existir no DB (1:1 unique).
    // A persistencia ao final do turn usa esse mesmo id.
    const pendingAssistantMessageId = crypto.randomUUID();
    context.pendingAssistantMessageId = pendingAssistantMessageId;

    // 3.7. Anexos do turn — extractedText vira prefixo do prompt do user.
    //      Guard: só anexos da session ativa.
    let attachmentsBlock = "";
    if (params.attachmentIds && params.attachmentIds.length > 0) {
      const attachments = await prisma.chatAttachment.findMany({
        where: {
          id: { in: params.attachmentIds },
          sessionId: activeSession.id,
        },
        select: { name: true, source: true, sourceUrl: true, extractedText: true },
      });
      if (attachments.length > 0) {
        const parts = attachments
          .filter((a) => a.extractedText && a.extractedText.trim().length > 0)
          .map((a) => {
            const icon = a.source === "url" ? "🔗" : "📄";
            const label = a.source === "url" && a.sourceUrl
              ? `${a.name} (${a.sourceUrl})`
              : a.name;
            return `${icon} ${label}:\n${a.extractedText}`;
          });
        if (parts.length > 0) {
          attachmentsBlock = `ANEXOS DESTE TURN (referencia pro usuario — o contrato em si esta na proxima secao):\n\n${parts.join("\n\n---\n\n")}\n\n---\n`;
        }
      }
    }

    const started: AgentEvent = {
      type: "started",
      mode,
      model: config.model,
      hasExpertContext: !!expertContext,
    };
    events.push(started);
    yield started;

    // 4. Messages + intent detection
    const history = await loadChatHistory(activeSession.id);
    const contextMsg = buildContextMessage({
      dataJson: context.dataJson,
      htmlContent: context.htmlContent,
      activeClauses: context.activeClauses,
      templateModalidade: context.templateModalidade,
      templateName: context.templateName,
      isGoogleDocs: !!context.googleDocId,
    });

    const EDIT_INTENT =
      /\b(altere|mude|troque|substitua|atualize|corrija|modifique|remova|insira|adicione|coloque|ponha|apague|delete|reescreva|inclua|retire|exclua)\b/i;
    const isEditCommand = EDIT_INTENT.test(params.message);

    const FORCE_DIRECT_EDIT =
      /\b(aplique\s+direto|aplique\s+já|faça\s+já|faça\s+agora|sem\s+revis[ãa]o|edite\s+direto|altere\s+agora|aplica\s+direto|sem\s+sugest[ãa]o)\b/i;
    const wantsDirectEdit = FORCE_DIRECT_EDIT.test(params.message);
    const isGoogleDocs = !!context.googleDocId;

    // Em modo Fast: sempre edição direta no GDoc (Haiku, 1 turn, sem cerimônia).
    // Em modo Plan + GDoc: propose_suggestion default (segurança), exceto se
    // o usuário disser "aplique direto".
    const preferProposeInGDocs = mode === "plan" && isGoogleDocs && !wantsDirectEdit;

    const editReminderTemplate = isEditCommand
      ? `\n\n---\nLEMBRETE DE FORMATO OBRIGATORIO: este pedido e um comando de edicao. Voce DEVE:\n1. Chamar pelo menos uma tool de edicao (${preferProposeInGDocs ? "PREFIRA propose_suggestion — o contrato esta em modo Google Docs e o usuario quer revisar antes de aplicar; só use edit_contract_section se a mensagem do usuario disser explicitamente 'aplique direto' / 'faça já' / 'sem revisao'" : "edit_contract_section, update_contract_data, insert_clause, remove_clause" + (mode === "plan" ? ", propose_suggestion" : "")}).\n2. Apos executar as tools, responder EXATAMENTE nesta estrutura em markdown (copie os 3 headings literais, sem emoji, sem alterar capitalizacao):\n\n## Alteracoes Realizadas\n(lista do que foi alterado no contrato)\n\n## Justificativa\n(razao juridica da alteracao)\n\n## Verificacao\n(como o usuario pode verificar que a alteracao foi aplicada)\n`
      : "";

    const expertBlock = expertContext ? `${expertContext}\n\n---\n` : "";
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user" as const,
        content: `${expertBlock}${attachmentsBlock}${contextMsg}${editReminderTemplate}\n\n---\nMENSAGEM DO USUÁRIO:\n${params.message}`,
      },
    ];

    // 5. Streaming loop
    const systemBlocks = [
      {
        type: "text" as const,
        text: config.systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ] as unknown as Anthropic.TextBlockParam[];

    const usageAgg = {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const toolsUsedSet = new Set<string>();
    const changeLogs: ChangeLogEntry[] = [];
    const t0 = Date.now();

    // Fast = 1 iteração só. Plan = até 5.
    const maxIterations = mode === "fast" ? 1 : 5;
    let iterations = 0;

    let turnResult: StreamedTurnResult;
    try {
      turnResult = yield* streamOneTurn({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: systemBlocks,
        tools: AGENT_TOOLS,
        ...(isEditCommand ? { tool_choice: { type: "any" as const } } : {}),
        messages,
        stream: true,
      });
    } catch (err) {
      recordAIUsage({
        orgId: params.orgId,
        userId: params.userId,
        contractId: params.contractId,
        provider: "anthropic",
        model: config.model,
        operation: "chat",
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

    // Loop tool-use
    while (turnResult.stopReason === "tool_use" && iterations < maxIterations) {
      iterations++;
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of turnResult.contentBlocks) {
        if (block.type !== "tool_use") continue;
        toolsUsedSet.add(block.name);

        // Emit tool_use ANTES de executar (UI mostra chip "em andamento").
        const useEvt: AgentEvent = {
          type: "tool_use",
          name: block.name,
          input: block.input as Record<string, unknown>,
          iteration: iterations,
        };
        events.push(useEvt);
        yield useEvt;

        // Tool errors must NOT terminate the stream. Sem este wrap, uma exception
        // num handler (ex.: Prisma 42703 em query_knowledge_base quando pgvector
        // não está populado) bolha pelo executeToolHandler → catch global do
        // generator → event `error` → cliente vê chat morto. Empacotamos em
        // {error} pra que o tool_result evento normal seja emitido e o agente
        // continue a iteração ou termine com texto.
        // Snapshot ANTES de executar — só vale a pena em writes contra GDoc.
        // Read tools (validate, query_*) não mutam o doc, então não snapshot.
        let htmlBefore: string | undefined;
        if (isEditTool(block.name) && context.googleDocId) {
          try {
            const { getDocPlainText } = await import("@/lib/google/docs");
            htmlBefore = await getDocPlainText(context.googleDocId);
          } catch {
            // Falha de Drive não bloqueia execução — segue sem snapshot.
          }
        }

        let result: ToolOutput;
        try {
          result = (await executeToolHandler(
            block.name,
            block.input as Record<string, unknown>,
            context
          )) as ToolOutput;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[streamContractAgent] tool ${block.name} threw:`, err);
          result = { error: `Tool ${block.name} falhou: ${msg.slice(0, 200)}` };
        }

        // Snapshot DEPOIS — apenas se houve before (write tool + GDoc) e o
        // result indica sucesso. Falha → htmlAfter fica igual a before, diff
        // é vazio (UI não mostra o turn no painel).
        let htmlAfter: string | undefined;
        if (htmlBefore !== undefined && context.googleDocId && !result.error) {
          try {
            const { getDocPlainText } = await import("@/lib/google/docs");
            htmlAfter = await getDocPlainText(context.googleDocId);
          } catch {
            htmlAfter = htmlBefore;
          }
        }

        const success = !result.error;
        const summary = summarizeToolResult(block.name, result);

        const resultEvt: AgentEvent = {
          type: "tool_result",
          name: block.name,
          iteration: iterations,
          success,
          summary,
        };
        events.push(resultEvt);
        yield resultEvt;

        // propose_plan: emit plan_proposed pra UI renderizar PlanCard.
        // O LLM ainda vai escrever texto explicativo no proximo turn.
        if (block.name === "propose_plan" && success && typeof result.planId === "string") {
          const planEvt: AgentEvent = {
            type: "plan_proposed",
            planId: result.planId as string,
            steps: (result.steps as PlanStep[]) || [],
          };
          events.push(planEvt);
          yield planEvt;
        }

        // Verificação explícita pra tools que populam `verified` (insert_clause,
        // remove_clause em GDocs). UI destaca com ícone diferente.
        if (typeof result.verified === "boolean" && isEditTool(block.name)) {
          const verifyEvt: AgentEvent = {
            type: "verification",
            tool: block.name,
            verified: result.verified,
            detail: result.verified
              ? "Mutação confirmada via releitura do doc"
              : String(result.error || "Releitura não confirmou a mutação"),
          };
          events.push(verifyEvt);
          yield verifyEvt;
        }

        changeLogs.push({
          action: mapToolToAction(block.name),
          summary: buildToolSummary(block.name, block.input as Record<string, unknown>),
          details: { tool: block.name, input: block.input, output: result },
          source: "ai",
          htmlBefore,
          htmlAfter,
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

      try {
        turnResult = yield* streamOneTurn({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          system: systemBlocks,
          tools: AGENT_TOOLS,
          messages,
          stream: true,
        });
      } catch (err) {
        recordAIUsage({
          orgId: params.orgId,
          userId: params.userId,
          contractId: params.contractId,
          provider: "anthropic",
          model: config.model,
          operation: "chat",
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

    // Agrega usage do turn inteiro (initial + N tool-use iterations)
    recordAIUsage({
      orgId: params.orgId,
      userId: params.userId,
      contractId: params.contractId,
      provider: "anthropic",
      model: config.model,
      operation: "chat",
      promptTokens: usageAgg.promptTokens,
      completionTokens: usageAgg.completionTokens,
      cacheReadTokens: usageAgg.cacheReadTokens,
      cacheWriteTokens: usageAgg.cacheWriteTokens,
      latencyMs: Date.now() - t0,
      toolsUsed: Array.from(toolsUsedSet),
      iterations: iterations + 1,
      success: true,
    });

    // Final text do último turn
    let finalMessage = "";
    for (const block of turnResult.contentBlocks) {
      if (block.type === "text") {
        finalMessage += block.text;
      }
    }

    // Persist change logs. Cap de snapshot em 50kb pra não estourar Text col
    // em turns que tocam contratos gigantes — o ChangesPanel já trunca pra UI
    // de qualquer jeito.
    if (changeLogs.length > 0) {
      const SNAPSHOT_CAP = 50_000;
      const trim = (s: string | undefined) =>
        s && s.length > SNAPSHOT_CAP ? s.slice(0, SNAPSHOT_CAP) : s ?? null;
      await prisma.contractChangeLog.createMany({
        data: changeLogs.map((log) => ({
          contractId: params.contractId,
          userId: params.userId,
          action: log.action,
          summary: log.summary,
          details: log.details as object,
          source: log.source,
          htmlBefore: trim(log.htmlBefore),
          htmlAfter: trim(log.htmlAfter),
          sessionId: activeSession.id,
        })),
      });
    }

    // Persist chat messages na session resolvida e toca updatedAt + auto-titula
    // se for o primeiro turn. Title derivado dos primeiros 60 chars da msg
    // do user (truncado limpo no espaço mais próximo do limite).
    const sessionRow = await prisma.chatSession.findUnique({
      where: { id: activeSession.id },
      select: { title: true },
    });
    const shouldAutoTitle = !sessionRow?.title;
    const autoTitle = shouldAutoTitle
      ? params.message.length <= 60
        ? params.message
        : params.message.slice(0, 57).replace(/\s+\S*$/, "") + "…"
      : null;

    await prisma.chatSession.update({
      where: { id: activeSession.id },
      data: {
        updatedAt: new Date(),
        ...(autoTitle ? { title: autoTitle } : {}),
      },
    });

    await prisma.chatMessage.createMany({
      data: [
        { sessionId: activeSession.id, role: "user", content: params.message },
        {
          // id pre-alocado pra propose_plan poder linkar ChatPlan.messageId
          // antes do final do turn. Cuid format funciona equivalente a uuid.
          id: pendingAssistantMessageId,
          sessionId: activeSession.id,
          role: "assistant",
          content: finalMessage || "Operação concluída.",
          metadata: { toolsUsed: changeLogs.map((l) => l.action), mode } as object,
          events: events as object,
        },
      ],
    });

    // Update contract content snapshot quando houve edição
    const hasEdits = changeLogs.some((l) =>
      ["ai_edit", "data_patch", "clause_added", "clause_removed"].includes(l.action)
    );
    if (hasEdits) {
      await prisma.contract.update({
        where: { id: params.contractId },
        data: {
          htmlContent: context.htmlContent,
          dataJson: context.dataJson as object,
        },
      });
    }

    const result: AgentResult = {
      message: finalMessage,
      htmlContent: hasEdits ? context.htmlContent : null,
      dataJson: hasEdits ? context.dataJson : null,
      changeLogs,
      events,
    };

    yield { type: "done", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[streamContractAgent] error:", err);
    yield { type: "error", message };
  }
}

/**
 * Wrapper síncrono — consome o stream completo e retorna AgentResult.
 * Usado por callers que não querem SSE (testes, scripts internos).
 */
export async function runContractAgent(params: AgentParams): Promise<AgentResult> {
  let result: AgentResult | null = null;
  let errorMessage: string | null = null;

  for await (const event of streamContractAgent(params)) {
    if (event.type === "done") result = event.result;
    else if (event.type === "error") errorMessage = event.message;
  }

  if (errorMessage && !result) {
    throw new Error(errorMessage);
  }

  return (
    result || {
      message: "Operação concluída sem retorno.",
      htmlContent: null,
      dataJson: null,
      changeLogs: [],
      events: [],
    }
  );
}

// ============================================
// PASSIVE ANALYSIS (autonomous, triggered by open/edit/approve)
// ============================================

export type PassiveAnalysisTrigger = "open" | "edit" | "approve";

export interface PassiveAnalysisParams {
  contractId: string;
  orgId: string;
  trigger: PassiveAnalysisTrigger;
  scope?: {
    from?: number;
    to?: number;
    changedText?: string;
  };
  /**
   * Optional override for the contract HTML. When the editor has unsaved edits,
   * the client passes the current HTML so the analyzer sees the live state
   * instead of the stale DB version.
   */
  htmlOverride?: string;
}

export interface PassiveFinding {
  severity: "info" | "warning" | "error";
  category: string;
  message: string;
  selectedText: string;
  suggestedFix?: string;
  source: "quickChecks" | "llm";
}

const PASSIVE_SYSTEM_PROMPT = `Você é um analisador de contratos imobiliários brasileiros. Sua única tarefa é apontar problemas concretos e objetivos: contradições lógicas, erros matemáticos, referências internas quebradas, duplicação de qualificação, prazos conflitantes, cláusulas mutuamente exclusivas.

REGRAS:
1. Responda APENAS em JSON válido, sem markdown, sem comentários, sem texto antes ou depois.
2. Formato: { "findings": [ { "severity": "info|warning|error", "category": "math|qualification|reference|format|logic", "message": "...", "selectedText": "trecho EXATO do contrato", "suggestedFix": "..." } ] }
3. Se não encontrar problemas, retorne { "findings": [] }.
4. selectedText DEVE ser copiado LITERALMENTE do contrato — qualquer divergência invalida o finding.
5. Seja específico: "valor X não bate com soma Y" é útil; "pode haver inconsistência" não.
6. Ignore questões de estilo, gramática e formatação. Foque em conteúdo jurídico.
7. No máximo 3 findings por chamada — priorize os mais críticos. Cada finding deve apontar UM problema único e distinto; não fragmente o mesmo problema em múltiplos findings.
8. message: máximo 2 frases curtas. Vá direto ao ponto, sem prólogo.
9. Se você já viu este trecho com este tipo de problema antes, NÃO repita — a deduplicação é por (categoria + trecho), não por phrasing.
10. NUNCA invente valores plausíveis para campos qualificatórios ausentes (profissão, nacionalidade, naturalidade, RG, estado civil, nome da mãe). Se o contrato tem esses campos vazios ou claramente inválidos (ex: "[preencher profissão]"), reporte como finding category="qualification" severity="warning" e suggestedFix="preencher manualmente — não invente". Profissões alucinadas como "economiário" são proibidas.`;

const MAX_AI_UNRESOLVED_COMMENTS = 50;

/**
 * Runs passive analysis on a contract. Uses Haiku for cheap on-edit passes
 * and Sonnet for on-open deep passes. Persists findings as ContractComment
 * with dedupeKey to avoid duplicates on re-analysis.
 */
export async function runPassiveAnalysis(
  params: PassiveAnalysisParams
): Promise<{ findings: PassiveFinding[]; commentsCreated: number; modelUsed: string }> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: params.contractId },
    include: { template: true },
  });

  if (contract.status === "aprovado") {
    return { findings: [], commentsCreated: 0, modelUsed: "none" };
  }

  const existingUnresolved = await prisma.contractComment.count({
    where: {
      contractId: params.contractId,
      authorType: "ai",
      resolved: false,
    },
  });
  if (existingUnresolved >= MAX_AI_UNRESOLVED_COMMENTS) {
    return {
      findings: [],
      commentsCreated: 0,
      modelUsed: `cap-reached:${existingUnresolved}`,
    };
  }

  try {
    await assertContractBudget(params.contractId);
  } catch (err) {
    if (err instanceof ContractBudgetExceededError) {
      return {
        findings: [],
        commentsCreated: 0,
        modelUsed: "budget-exceeded",
      };
    }
    throw err;
  }

  if (params.trigger === "edit") {
    const lastValidation = await prisma.contractChangeLog.findFirst({
      where: { contractId: params.contractId, action: "validation" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastValidation) {
      const newerEdit = await prisma.contractChangeLog.findFirst({
        where: {
          contractId: params.contractId,
          action: { not: "validation" },
          createdAt: { gt: lastValidation.createdAt },
        },
        select: { id: true },
      });
      if (!newerEdit) {
        return {
          findings: [],
          commentsCreated: 0,
          modelUsed: "skipped-no-change",
        };
      }
    }
  }

  let htmlContent: string;
  if (contract.googleDocId) {
    const { getDocPlainText } = await import("@/lib/google/docs");
    htmlContent = await getDocPlainText(contract.googleDocId);
  } else {
    htmlContent = params.htmlOverride || contract.htmlContent || "";
  }

  const quick: QuickFinding[] = quickChecks(contract.dataJson, htmlContent);
  const quickFindings: PassiveFinding[] = quick.map((q) => ({ ...q, source: "quickChecks" }));

  let llmFindings: PassiveFinding[] = [];
  let modelUsed = "quickChecks-only";

  if (params.trigger === "approve") {
    // Nothing to do — /approve route handles validation
  } else {
    const passiveModel =
      params.trigger === "open"
        ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
        : process.env.ANTHROPIC_PASSIVE_MODEL || "claude-haiku-4-5-20251001";
    modelUsed = passiveModel;

    let analysisInput: string;
    if (params.scope?.changedText) {
      const idx = htmlContent.indexOf(params.scope.changedText);
      const before = idx > 0 ? htmlContent.slice(Math.max(0, idx - 500), idx) : "";
      const after = idx >= 0 ? htmlContent.slice(idx + params.scope.changedText.length, idx + params.scope.changedText.length + 500) : "";
      analysisInput = `CONTEXTO ANTES:\n${before}\n\n--- TRECHO EDITADO ---\n${params.scope.changedText}\n--- FIM ---\n\nCONTEXTO DEPOIS:\n${after}`;
    } else {
      analysisInput = htmlContent.slice(0, 8000);
    }

    const t0 = Date.now();
    try {
      const response = await anthropic.messages.create({
        model: passiveModel,
        max_tokens: 1024,
        temperature: 0.1,
        system: PASSIVE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `DADOS DO CONTRATO (JSON):\n${JSON.stringify(contract.dataJson, null, 2)}\n\n---\n\nHTML DO CONTRATO:\n${analysisInput}`,
          },
        ],
      });

      recordAIUsage({
        orgId: params.orgId,
        userId: null,
        contractId: params.contractId,
        provider: "anthropic",
        model: passiveModel,
        operation: params.trigger === "open" ? "passive_open" : "passive_edit",
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: (response.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0,
        latencyMs: Date.now() - t0,
        success: true,
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const match = textBlock.text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]) as { findings?: PassiveFinding[] };
            if (Array.isArray(parsed.findings)) {
              llmFindings = parsed.findings
                .filter((f) => f && f.selectedText && htmlContent.includes(f.selectedText))
                .map((f) => ({ ...f, source: "llm" as const }));
            }
          } catch {
            // Invalid JSON — ignore and fall through
          }
        }
      }
    } catch (err) {
      recordAIUsage({
        orgId: params.orgId,
        userId: null,
        contractId: params.contractId,
        provider: "anthropic",
        model: passiveModel,
        operation: params.trigger === "open" ? "passive_open" : "passive_edit",
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      console.error("[runPassiveAnalysis] LLM call failed:", err);
    }
  }

  const allFindings = [...quickFindings, ...llmFindings];

  let commentsCreated = 0;
  for (const finding of allFindings) {
    const dedupeKey = dedupeKeyFor("ai", finding.category, finding.selectedText);
    try {
      await prisma.contractComment.upsert({
        where: {
          contractId_dedupeKey: {
            contractId: params.contractId,
            dedupeKey,
          },
        },
        create: {
          contractId: params.contractId,
          userId: null,
          authorName: "Assistente IA",
          authorType: "ai",
          text: finding.message + (finding.suggestedFix ? `\n\nSugestão: ${finding.suggestedFix}` : ""),
          anchorId: dedupeKey,
          selectedText: finding.selectedText,
          severity: finding.severity,
          dedupeKey,
        },
        update: {
          updatedAt: new Date(),
        },
      });
      commentsCreated++;
    } catch (err) {
      console.error("[runPassiveAnalysis] Failed to upsert comment:", err);
    }
  }

  await prisma.contractChangeLog.create({
    data: {
      contractId: params.contractId,
      userId: null,
      action: "validation",
      summary: `Análise automática (${params.trigger}): ${allFindings.length} findings, ${commentsCreated} comentários persistidos`,
      details: {
        trigger: params.trigger,
        modelUsed,
        quickFindingsCount: quickFindings.length,
        llmFindingsCount: llmFindings.length,
        scope: params.scope || null,
      },
      source: "ai",
    },
  });

  return { findings: allFindings, commentsCreated, modelUsed };
}
