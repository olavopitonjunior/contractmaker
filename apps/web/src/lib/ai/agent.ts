import { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { AGENT_TOOLS } from "./tools";
import { executeToolHandler } from "./tool-handlers";
import { DEFAULT_SYSTEM_PROMPT, buildContextMessage } from "./prompts";
import type { AgentContext, AgentResult, ChangeLogEntry } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  const maxIterations = 10;

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
