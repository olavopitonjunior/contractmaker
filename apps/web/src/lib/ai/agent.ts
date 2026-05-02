import { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { AGENT_TOOLS } from "./tools";
import { executeToolHandler } from "./tool-handlers";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "./prompts";
import { quickChecks, dedupeKeyFor, type QuickFinding } from "./quickChecks";
import { recordAIUsage } from "./usage";
import type { AgentContext, AgentResult, ChangeLogEntry } from "./types";

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
}

async function getAgentConfig(orgId: string) {
  const config = await prisma.agentConfig.findUnique({ where: { orgId } });
  return {
    model: config?.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
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
  // Buscamos texto plano via Drive export — read-only tools (validate,
  // analyze_contradictions, suggest_improvements) que dependiam de
  // `htmlContent` agora veem o estado live do doc.
  let htmlContent: string;
  if (contract.googleDocId) {
    const { getDocPlainText } = await import("@/lib/google/docs");
    htmlContent = await getDocPlainText(contract.googleDocId);
  } else {
    htmlContent =
      contract.htmlContent ||
      renderContratoHTML(
        contract.templateOverride || contract.template.handlebarsSource,
        contract.dataJson as Record<string, unknown>
      );
  }

  return {
    contractId,
    userId: contract.userId,
    orgId,
    htmlContent,
    dataJson: contract.dataJson as Record<string, unknown>,
    templateSource: contract.templateOverride || contract.template.handlebarsSource,
    templateModalidade: contract.template.modalidade || "a_vista",
    templateName: contract.template.name,
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
    default:
      return `Executou ${toolName}`;
  }
}

export async function runContractAgent(params: AgentParams): Promise<AgentResult> {
  // 1. Check contract status
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: params.contractId },
  });

  if (contract.status === "aprovado") {
    return {
      message: "⚠️ Este contrato já foi aprovado e não pode mais ser alterado. Para modificações, crie uma nova versão a partir do deal.",
      htmlContent: null,
      dataJson: null,
      changeLogs: [],
    };
  }

  // 2. Load agent config
  const config = await getAgentConfig(params.orgId);

  // 3. Load contract context
  const context = await loadContext(params.contractId, params.orgId);

  // 4. Build messages with history
  const history = await loadChatHistory(params.contractId);
  const contextMsg = buildContextMessage({
    dataJson: context.dataJson,
    htmlContent: context.htmlContent,
    activeClauses: context.activeClauses,
    templateModalidade: context.templateModalidade,
    templateName: context.templateName,
  });

  // Classify intent: if the message looks like an edit command, force tool use
  // on the first iteration so the agent cannot respond conversationally without
  // actually mutating the contract. Regex picks up common PT-BR verbs.
  const EDIT_INTENT =
    /\b(altere|mude|troque|substitua|atualize|corrija|modifique|remova|insira|adicione|coloque|ponha|apague|delete|reescreva|reescreva|inclua|retire|exclua)\b/i;
  const isEditCommand = EDIT_INTENT.test(params.message);

  const editReminderTemplate = isEditCommand
    ? `\n\n---\nLEMBRETE DE FORMATO OBRIGATORIO: este pedido e um comando de edicao. Voce DEVE:\n1. Chamar pelo menos uma tool de edicao (edit_contract_section, update_contract_data, insert_clause, remove_clause, propose_suggestion).\n2. Apos executar as tools, responder EXATAMENTE nesta estrutura em markdown (copie os 3 headings literais, sem emoji, sem alterar capitalizacao):\n\n## Alteracoes Realizadas\n(lista do que foi alterado no contrato)\n\n## Justificativa\n(razao juridica da alteracao)\n\n## Verificacao\n(como o usuario pode verificar que a alteracao foi aplicada)\n`
    : "";

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `${contextMsg}${editReminderTemplate}\n\n---\nMENSAGEM DO USUÁRIO:\n${params.message}`,
    },
  ];

  // 5. Call Anthropic with tools — tracking aggregate usage across the loop
  const usageAgg = {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const toolsUsedSet = new Set<string>();
  const t0 = Date.now();

  let response;
  try {
    response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      tools: AGENT_TOOLS,
      // Force the model into tool-use mode when the intent is clearly an edit.
      // Without this, Sonnet sometimes replies conversationally on the first
      // iteration ("Alteracao concluida") WITHOUT calling any edit tool.
      ...(isEditCommand ? { tool_choice: { type: "any" as const } } : {}),
      messages,
    });
    usageAgg.promptTokens += response.usage?.input_tokens ?? 0;
    usageAgg.completionTokens += response.usage?.output_tokens ?? 0;
    usageAgg.cacheReadTokens += (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0;
    usageAgg.cacheWriteTokens += (response.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0;
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

  const changeLogs: ChangeLogEntry[] = [];
  let iterations = 0;
  const maxIterations = 5;

  // 6. Tool-use loop
  while (response.stop_reason === "tool_use" && iterations < maxIterations) {
    iterations++;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolsUsedSet.add(block.name);
        const result = await executeToolHandler(
          block.name,
          block.input as Record<string, unknown>,
          context
        );

        // Log every tool use
        changeLogs.push({
          action: mapToolToAction(block.name),
          summary: buildToolSummary(block.name, block.input as Record<string, unknown>),
          details: {
            tool: block.name,
            input: block.input,
            output: result,
          },
          source: "ai",
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Continue conversation with tool results
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });
    usageAgg.promptTokens += response.usage?.input_tokens ?? 0;
    usageAgg.completionTokens += response.usage?.output_tokens ?? 0;
    usageAgg.cacheReadTokens += (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0;
    usageAgg.cacheWriteTokens += (response.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0;
  }

  // Record aggregated usage for the whole turn (initial + N tool-use iterations)
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

  // 7. Extract final text
  let finalMessage = "";
  for (const block of response.content) {
    if (block.type === "text") {
      finalMessage += block.text;
    }
  }

  // 8. Persist change logs
  if (changeLogs.length > 0) {
    await prisma.contractChangeLog.createMany({
      data: changeLogs.map((log) => ({
        contractId: params.contractId,
        userId: params.userId,
        action: log.action,
        summary: log.summary,
        details: log.details as any,
        source: log.source,
      })),
    });
  }

  // 9. Save chat messages
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
        metadata: { toolsUsed: changeLogs.map((l) => l.action) } as any,
      },
    ],
  });

  // 10. Update contract if context was modified
  const hasEdits = changeLogs.some((l) =>
    ["ai_edit", "data_patch", "clause_added", "clause_removed"].includes(l.action)
  );

  if (hasEdits) {
    await prisma.contract.update({
      where: { id: params.contractId },
      data: {
        htmlContent: context.htmlContent,
        dataJson: context.dataJson as any,
      },
    });
  }

  return {
    message: finalMessage,
    htmlContent: hasEdits ? context.htmlContent : null,
    dataJson: hasEdits ? context.dataJson : null,
    changeLogs,
  };
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
9. Se você já viu este trecho com este tipo de problema antes, NÃO repita — a deduplicação é por (categoria + trecho), não por phrasing.`;

// Cap absoluto de comentários AI não-resolvidos por contrato. Quando atingido,
// runPassiveAnalysis retorna sem chamar LLM. Limite calibrado: 50 é suficiente
// pra cobrir os principais problemas de um contrato; acima disso o sinal vira
// ruído e custo (incidente cmons9hbh: 942 comments / $10 USD num único doc).
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

  // Cap: se já há muitos comments AI não-resolvidos, não dispara LLM. O usuário
  // precisa resolver/limpar antes de a IA gerar mais. Evita o cenário do contrato
  // cmons9hbh (942 comments / $10 USD em uma sessão de teste).
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

  // Skip-no-change: se a última run de validação foi APÓS a última edição
  // detectável (ChangeLog não-validation), não há mudança nova — pula LLM.
  // Isso elimina re-runs caros quando o usuário só abre o doc e nada muda.
  // Não aplica a trigger="open" porque o usuário pode estar abrindo após reload.
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

  // Quando o contrato vive em um Google Doc, busca o texto plano via Drive
  // export — substitui o HTML do TipTap como fonte de verdade. Quick checks
  // que dependiam de regex em HTML são tolerantes a texto plano.
  let htmlContent: string;
  if (contract.googleDocId) {
    const { getDocPlainText } = await import("@/lib/google/docs");
    htmlContent = await getDocPlainText(contract.googleDocId);
  } else {
    htmlContent =
      params.htmlOverride ||
      contract.htmlContent ||
      renderContratoHTML(
        contract.templateOverride || contract.template.handlebarsSource,
        contract.dataJson as Record<string, unknown>
      );
  }

  // 1. Client-safe deterministic checks first
  const quick: QuickFinding[] = quickChecks(contract.dataJson, htmlContent);
  const quickFindings: PassiveFinding[] = quick.map((q) => ({ ...q, source: "quickChecks" }));

  // 2. Decide whether to call LLM
  // - On 'open' (first load): always call LLM for deep analysis with Sonnet
  // - On 'edit' (passive): always call LLM with Haiku. quickChecks only covers
  //   data-bound checks (dataJson) but manual HTML edits require LLM to catch
  //   inconsistencies that don't show up in the structured data.
  // - On 'approve': validators run elsewhere, we skip here
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

    // Build analysis prompt — trim context when doing edit-scoped analysis
    let analysisInput: string;
    if (params.scope?.changedText) {
      const idx = htmlContent.indexOf(params.scope.changedText);
      const before = idx > 0 ? htmlContent.slice(Math.max(0, idx - 500), idx) : "";
      const after = idx >= 0 ? htmlContent.slice(idx + params.scope.changedText.length, idx + params.scope.changedText.length + 500) : "";
      analysisInput = `CONTEXTO ANTES:\n${before}\n\n--- TRECHO EDITADO ---\n${params.scope.changedText}\n--- FIM ---\n\nCONTEXTO DEPOIS:\n${after}`;
    } else {
      // Reduzido de 15000 → 8000 chars: contratos típicos cabem com folga; cap
      // reduz custo proporcional em ~47% no input. Os findings críticos
      // (cláusulas 1-9) ficam completos.
      analysisInput = htmlContent.slice(0, 8000);
    }

    const t0 = Date.now();
    try {
      const response = await anthropic.messages.create({
        model: passiveModel,
        // Reduzido de 2048 → 1024: 3 findings × ~250 tokens cabem confortável.
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
        // Extract JSON from response (model may add stray whitespace)
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

  // 3. Persist findings as ContractComment with dedupeKey (upsert pattern).
  // dedupeKey é (authorType + category + selectedText) — não inclui a mensagem
  // da LLM porque ela varia entre runs com o mesmo problema (188× duplicação
  // observada no contrato fixture cmons9hbh).
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
          // Touch updatedAt so we know the finding is still current
          updatedAt: new Date(),
        },
      });
      commentsCreated++;
    } catch (err) {
      console.error("[runPassiveAnalysis] Failed to upsert comment:", err);
    }
  }

  // 4. Log the analysis run
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
