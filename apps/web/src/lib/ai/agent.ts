import { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { AGENT_TOOLS } from "./tools";
import { executeToolHandler } from "./tool-handlers";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "./prompts";
import { quickChecks, dedupeKeyFor, type QuickFinding } from "./quickChecks";
import { recordAIUsage } from "./usage";
import { assertContractBudget, ContractBudgetExceededError } from "./budget";
import { loadExpertContext } from "./expert-context";
import type {
  AgentContext,
  AgentEvent,
  AgentMode,
  AgentResult,
  ChangeLogEntry,
} from "./types";

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada. Adicione a chave no .env");
  }
  return new Anthropic({ apiKey });
}
const anthropic = getAnthropicClient();

interface AgentParams {
  message: string;
  contractId: string;
  userId: string;
  orgId: string;
  /** Modo do agente. Default 'plan' (multi-turn com expert context). */
  mode?: AgentMode;
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

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

async function loadContext(contractId: string, orgId: string): Promise<AgentContext> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      template: true,
      clauses: {
        where: { isActive: true },
        include: { clause: { select: { id: true, title: true, category: true } } },
        orderBy: { position: "asc" },
      },
    },
  });

  // Quando o contrato é Google Doc, o doc é a fonte de verdade do texto.
  // Texto vivo via Drive export (read-only tools como validate/analyze_contradictions/
  // suggest_improvements veem o estado atual do doc). Snapshot persistido é
  // fallback defensivo quando Drive falha ou quando o contrato (legado) ainda
  // não tem doc associado.
  let htmlContent: string;
  if (contract.googleDocId) {
    const { getDocPlainText } = await import("@/lib/google/docs");
    htmlContent = await getDocPlainText(contract.googleDocId);
  } else {
    htmlContent = contract.htmlContent || "";
  }

  return {
    contractId,
    userId: contract.userId,
    orgId,
    htmlContent,
    dataJson: contract.dataJson as Record<string, unknown>,
    templateSource: contract.template
      ? contract.templateOverride || contract.template.handlebarsSource
      : null,
    templateModalidade: contract.template?.modalidade || "a_vista",
    templateName: contract.template?.name ?? "Contrato importado",
    activeClauses: contract.clauses.map((cc) => ({
      id: cc.id,
      clauseId: cc.clause.id,
      title: cc.clause.title,
      category: cc.clause.category,
      position: cc.position,
      isActive: cc.isActive,
    })),
    googleDocId: contract.googleDocId,
  };
}

async function loadChatHistory(contractId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { contractId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
    orderBy: { createdAt: "desc" },
  });
  if (!session?.messages.length) return [];

  return session.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

function mapToolToAction(toolName: string): string {
  const map: Record<string, string> = {
    query_clauses: "ai_query",
    query_templates: "ai_query",
    explain_clause: "ai_query",
    edit_contract_section: "ai_edit",
    update_contract_data: "data_patch",
    insert_clause: "clause_added",
    remove_clause: "clause_removed",
    validate_contract: "validation",
    suggest_improvements: "validation",
    extract_document_data: "ocr_extraction",
    add_comment: "ai_query",
    analyze_contradictions: "validation",
    query_knowledge_base: "ai_query",
    find_similar_contracts: "ai_query",
    propose_new_clause: "ai_query",
    propose_template_change: "ai_query",
    apply_style_preset: "ai_edit",
    insert_image: "ai_edit",
  };
  return map[toolName] || "ai_edit";
}

function buildToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "query_clauses":
      return `Consultou cláusulas${input.category ? ` (categoria: ${input.category})` : ""}${input.search ? ` (busca: "${input.search}")` : ""}`;
    case "edit_contract_section":
      return `Editou seção do contrato: substituiu ${(input.target as string)?.length || 0} caracteres`;
    case "update_contract_data":
      return `Atualizou dados: ${Object.keys(input.patch as Record<string, unknown> || {}).join(", ")}`;
    case "insert_clause":
      return `Inseriu cláusula ID ${input.clauseId}`;
    case "remove_clause":
      return `Removeu cláusula ID ${input.clauseId}`;
    case "validate_contract":
      return "Executou validação completa do contrato";
    case "suggest_improvements":
      return `Gerou sugestões de melhoria${input.focus ? ` (foco: ${input.focus})` : ""}`;
    case "extract_document_data":
      return `Extraiu dados do documento ${input.attachmentId}`;
    case "query_knowledge_base":
      return `Consultou base${input.query ? `: "${(input.query as string).slice(0, 60)}"` : ""}`;
    case "find_similar_contracts":
      return "Buscou contratos similares aprovados";
    case "propose_suggestion":
      return `Propôs alteração (${input.type || "replacement"})`;
    case "add_comment":
      return `Adicionou comentário ${input.severity ? `[${input.severity}]` : ""}`;
    default:
      return `Executou ${toolName}`;
  }
}

// Tool names que são tentativas de mutação no contrato — usado pra determinar
// se um turn produziu edição (pra refresh do htmlContent no client) e pra
// gating em "Resolver com IA" (só marca resolved se houve edição com sucesso).
const EDIT_TOOL_NAMES = new Set([
  "edit_contract_section",
  "update_contract_data",
  "insert_clause",
  "remove_clause",
  "apply_style_preset",
  "insert_image",
]);

interface ToolOutput {
  success?: boolean;
  verified?: boolean;
  error?: string;
  [k: string]: unknown;
}

function isEditTool(name: string): boolean {
  return EDIT_TOOL_NAMES.has(name);
}

function summarizeToolResult(name: string, output: ToolOutput): string {
  if (output.error) return String(output.error).slice(0, 200);
  if (name === "edit_contract_section" && typeof output.occurrencesChanged === "number") {
    return `${output.occurrencesChanged} ocorrência(s) substituída(s)`;
  }
  if (name === "insert_clause" && output.success) return "Cláusula inserida";
  if (name === "remove_clause" && output.success) return "Cláusula removida";
  if (output.success) return "OK";
  return "Concluído";
}

interface StreamedTurnResult {
  contentBlocks: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message["stop_reason"] | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/**
 * Roda UMA chamada à API Anthropic em streaming e emite eventos `text_delta`
 * pelo generator. Acumula blocos de content e retorna no final pra continuar
 * o loop tool-use.
 */
async function* streamOneTurn(
  params: Anthropic.MessageCreateParamsStreaming
): AsyncGenerator<AgentEvent, StreamedTurnResult, void> {
  const stream = await anthropic.messages.create(params);

  const contentBlocks: Anthropic.ContentBlock[] = [];
  let currentText = "";
  let currentToolUse:
    | { id: string; name: string; jsonBuf: string }
    | null = null;
  let stopReason: Anthropic.Message["stop_reason"] | null = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for await (const evt of stream) {
    if (evt.type === "message_start") {
      usage.input += evt.message.usage?.input_tokens ?? 0;
      const u = evt.message.usage as {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      usage.cacheRead += u?.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u?.cache_creation_input_tokens ?? 0;
    } else if (evt.type === "content_block_start") {
      const cb = evt.content_block;
      if (cb.type === "text") {
        currentText = "";
      } else if (cb.type === "tool_use") {
        currentToolUse = { id: cb.id, name: cb.name, jsonBuf: "" };
      }
    } else if (evt.type === "content_block_delta") {
      const d = evt.delta;
      if (d.type === "text_delta") {
        currentText += d.text;
        yield { type: "text_delta", text: d.text };
      } else if (d.type === "input_json_delta" && currentToolUse) {
        currentToolUse.jsonBuf += d.partial_json;
      }
    } else if (evt.type === "content_block_stop") {
      if (currentToolUse) {
        let input: Record<string, unknown> = {};
        if (currentToolUse.jsonBuf) {
          try {
            input = JSON.parse(currentToolUse.jsonBuf) as Record<string, unknown>;
          } catch {
            // Buf incompleto / inválido — manda input vazio, handler trata.
          }
        }
        contentBlocks.push({
          type: "tool_use",
          id: currentToolUse.id,
          name: currentToolUse.name,
          input,
        });
        currentToolUse = null;
      } else if (currentText) {
        contentBlocks.push({
          type: "text",
          text: currentText,
          citations: null,
        } as unknown as Anthropic.ContentBlock);
        currentText = "";
      }
    } else if (evt.type === "message_delta") {
      stopReason = evt.delta.stop_reason;
      usage.output += evt.usage?.output_tokens ?? 0;
    }
  }

  return { contentBlocks, stopReason, usage };
}

/**
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

    const started: AgentEvent = {
      type: "started",
      mode,
      model: config.model,
      hasExpertContext: !!expertContext,
    };
    events.push(started);
    yield started;

    // 4. Messages + intent detection
    const history = await loadChatHistory(params.contractId);
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
        content: `${expertBlock}${contextMsg}${editReminderTemplate}\n\n---\nMENSAGEM DO USUÁRIO:\n${params.message}`,
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

    // Persist change logs
    if (changeLogs.length > 0) {
      await prisma.contractChangeLog.createMany({
        data: changeLogs.map((log) => ({
          contractId: params.contractId,
          userId: params.userId,
          action: log.action,
          summary: log.summary,
          details: log.details as object,
          source: log.source,
        })),
      });
    }

    // Persist chat messages
    let session = await prisma.chatSession.findFirst({
      where: { contractId: params.contractId },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      session = await prisma.chatSession.create({
        data: { contractId: params.contractId, userId: params.userId },
      });
    }

    await prisma.chatMessage.createMany({
      data: [
        { sessionId: session.id, role: "user", content: params.message },
        {
          sessionId: session.id,
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
