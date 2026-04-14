import { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { AGENT_TOOLS } from "./tools";
import { executeToolHandler } from "./tool-handlers";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "./prompts";
import { quickChecks, dedupeKeyFor, type QuickFinding } from "./quickChecks";
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

  return {
    contractId,
    userId: contract.userId,
    orgId,
    htmlContent: contract.htmlContent || renderContratoHTML(
      contract.templateOverride || contract.template.handlebarsSource,
      contract.dataJson as Record<string, unknown>
    ),
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

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `${contextMsg}\n\n---\nMENSAGEM DO USUÁRIO:\n${params.message}`,
    },
  ];

  // 5. Call Anthropic with tools
  let response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: config.systemPrompt,
    tools: AGENT_TOOLS,
    messages,
  });

  const changeLogs: ChangeLogEntry[] = [];
  let iterations = 0;
  const maxIterations = 5;

  // 6. Tool-use loop
  while (response.stop_reason === "tool_use" && iterations < maxIterations) {
    iterations++;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
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
  }

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
7. No máximo 5 findings por chamada — priorize os mais críticos.`;

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

  const htmlContent =
    params.htmlOverride ||
    contract.htmlContent ||
    renderContratoHTML(
      contract.templateOverride || contract.template.handlebarsSource,
      contract.dataJson as Record<string, unknown>
    );

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
      analysisInput = htmlContent.slice(0, 15000);
    }

    try {
      const response = await anthropic.messages.create({
        model: passiveModel,
        max_tokens: 2048,
        temperature: 0.1,
        system: PASSIVE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `DADOS DO CONTRATO (JSON):\n${JSON.stringify(contract.dataJson, null, 2)}\n\n---\n\nHTML DO CONTRATO:\n${analysisInput}`,
          },
        ],
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
      // LLM call failed — don't break the whole analysis, just return quickChecks
      console.error("[runPassiveAnalysis] LLM call failed:", err);
    }
  }

  const allFindings = [...quickFindings, ...llmFindings];

  // 3. Persist findings as ContractComment with dedupeKey (upsert pattern)
  let commentsCreated = 0;
  for (const finding of allFindings) {
    const dedupeKey = dedupeKeyFor("ai", finding.selectedText, finding.message);
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
