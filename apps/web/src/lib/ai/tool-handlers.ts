import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { validateContractData } from "./validators";
import { extractDocumentData } from "./ocr";
import { quickChecks } from "./quickChecks";
import { embedOne, toPgVector, VoyageError, isEmbeddingsConfigured } from "./embeddings";
import { findSimilarContracts } from "./memory";
import {
  googleEditSection,
  googleInsertClause,
  googleRemoveClause,
  googleAddComment,
  googleProposeSuggestion,
  googleApplyStylePreset,
  googleInsertImage,
} from "./google-tool-handlers";
import type { AgentContext, ValidationIssue, ClauseSuggestion } from "./types";

function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function executeToolHandler(
  toolName: string,
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "query_clauses":
      return handleQueryClauses(input, context);
    case "query_templates":
      return handleQueryTemplates(input, context);
    case "explain_clause":
      return handleExplainClause(input);
    case "edit_contract_section":
      return handleEditSection(input, context);
    case "update_contract_data":
      return handleUpdateData(input, context);
    case "propose_suggestion":
      return handleProposeSuggestion(input, context);
    case "insert_clause":
      return handleInsertClause(input, context);
    case "remove_clause":
      return handleRemoveClause(input, context);
    case "validate_contract":
      return handleValidateContract(context);
    case "suggest_improvements":
      return handleSuggestImprovements(input, context);
    case "extract_document_data":
      return handleExtractDocument(input);
    case "add_comment":
      return handleAddComment(input, context);
    case "analyze_contradictions":
      return handleAnalyzeContradictions(input, context);
    case "query_knowledge_base":
      return handleQueryKnowledgeBase(input, context);
    case "find_similar_contracts":
      return handleFindSimilarContracts(input, context);
    case "propose_new_clause":
      return handleProposeNewClause(input, context);
    case "propose_template_change":
      return handleProposeTemplateChange(input, context);
    case "apply_style_preset":
      return handleApplyStylePreset(input, context);
    case "insert_image":
      return handleInsertImage(input, context);
    case "propose_plan":
      return handleProposePlan(input, context);
    default:
      return { error: `Tool desconhecida: ${toolName}` };
  }
}

const READ_TOOL_NAMES = new Set([
  "validate_contract",
  "query_clauses",
  "query_templates",
  "explain_clause",
  "query_knowledge_base",
  "find_similar_contracts",
  "analyze_contradictions",
  "suggest_improvements",
]);

/**
 * Handler do `propose_plan`. Recebe array de steps do LLM, auto-executa os
 * `type:"read"` chamando executeToolHandler recursivamente, persiste ChatPlan
 * com messageId pre-alocado (context.pendingAssistantMessageId), e retorna
 * {planId, readsCompleted, writesPending} pro LLM continuar com texto
 * explicativo.
 *
 * Writes NUNCA executam aqui — ficam pendentes esperando POST /execute-plan
 * que o usuario dispara via PlanCard na UI.
 */
async function handleProposePlan(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const sessionId = context.sessionId;
  const messageId = context.pendingAssistantMessageId;
  if (!sessionId || !messageId) {
    return {
      error:
        "propose_plan exige sessionId + messageId no context. Bug interno do agente.",
    };
  }

  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length === 0) {
    return { error: "Plano vazio — informe ao menos um step." };
  }
  if (rawSteps.length > 12) {
    return { error: "Plano com >12 steps — quebre em partes." };
  }

  type RawStep = {
    type?: string;
    tool?: string;
    input?: Record<string, unknown>;
    description?: string;
  };
  type PersistedStep = {
    id: string;
    type: "read" | "write";
    tool: string;
    input: Record<string, unknown>;
    description: string;
    status: "pending" | "approved" | "rejected" | "executed" | "failed";
    result?: { success: boolean; summary: string };
  };

  const steps: PersistedStep[] = rawSteps.map((s: unknown, idx: number) => {
    const r = (s ?? {}) as RawStep;
    return {
      id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      type: r.type === "read" ? "read" : "write",
      tool: typeof r.tool === "string" ? r.tool : "unknown",
      input: (typeof r.input === "object" && r.input ? r.input : {}) as Record<string, unknown>,
      description:
        typeof r.description === "string" && r.description.trim().length > 0
          ? r.description.trim()
          : `${r.tool ?? "?"}`,
      status: "pending",
    };
  });

  let readsCompleted = 0;
  let writesPending = 0;

  for (const step of steps) {
    if (step.type !== "read") {
      writesPending++;
      continue;
    }
    if (!READ_TOOL_NAMES.has(step.tool)) {
      // LLM pediu pra rodar como read um tool que nao e read — marca falha
      step.status = "failed";
      step.result = {
        success: false,
        summary: `Tool ${step.tool} nao e read — pule pra writes ou use um nome valido.`,
      };
      continue;
    }
    try {
      const result = (await executeToolHandler(step.tool, step.input, context)) as {
        error?: string;
        [k: string]: unknown;
      };
      if (result.error) {
        step.status = "failed";
        step.result = { success: false, summary: String(result.error).slice(0, 200) };
      } else {
        step.status = "executed";
        step.result = {
          success: true,
          summary: summarizePlanReadResult(step.tool, result),
        };
        readsCompleted++;
      }
    } catch (err) {
      step.status = "failed";
      step.result = {
        success: false,
        summary: err instanceof Error ? err.message.slice(0, 200) : String(err),
      };
    }
  }

  const plan = await prisma.chatPlan.create({
    data: {
      sessionId,
      messageId,
      stepsJson: steps as object,
      status: "proposed",
    },
    select: { id: true },
  });

  return {
    planId: plan.id,
    readsCompleted,
    writesPending,
    steps,
  };
}

/** Sumariza output de tools de read pra mostrar no PlanCard. */
function summarizePlanReadResult(tool: string, result: Record<string, unknown>): string {
  if (tool === "validate_contract") {
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const errors = issues.filter((i: { severity?: string }) => i.severity === "error").length;
    const warnings = issues.filter((i: { severity?: string }) => i.severity === "warning").length;
    return `${errors} erro(s), ${warnings} aviso(s)`;
  }
  if (tool === "analyze_contradictions") {
    const c = Array.isArray(result.contradictions) ? result.contradictions.length : 0;
    return `${c} contradiç${c === 1 ? "ão" : "ões"} encontrada(s)`;
  }
  if (tool === "find_similar_contracts") {
    const m = Array.isArray(result.matches) ? result.matches.length : 0;
    return `${m} contrato(s) similar(es)`;
  }
  if (tool === "query_knowledge_base") {
    const r = Array.isArray(result.results) ? result.results.length : 0;
    return `${r} entrada(s) na base`;
  }
  if (tool === "suggest_improvements") {
    const s = Array.isArray(result.suggestions) ? result.suggestions.length : 0;
    return `${s} sugestão(ões)`;
  }
  return "OK";
}

async function handleApplyStylePreset(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const presetId = typeof input.presetId === "string" ? input.presetId : null;
  const presetName = typeof input.presetName === "string" ? input.presetName : null;

  let style;
  if (presetId) {
    style = await prisma.documentStyle.findFirst({
      where: { id: presetId, orgId: context.orgId },
    });
  } else if (presetName) {
    style = await prisma.documentStyle.findFirst({
      where: { orgId: context.orgId, name: { equals: presetName, mode: "insensitive" } },
    });
  } else {
    style = await prisma.documentStyle.findFirst({
      where: { orgId: context.orgId, isDefault: true },
    });
  }

  if (!style) {
    return {
      error:
        "Nenhum preset encontrado. Peça ao usuário para criar um em /settings/document-styles.",
    };
  }

  // Google Docs path: aplica via updateTextStyle/updateParagraphStyle/updateDocumentStyle
  if (context.googleDocId) {
    const result = await googleApplyStylePreset(context.googleDocId, {
      fontFamily: style.fontFamily,
      fontSizeBase: style.fontSizeBase,
      lineHeight: style.lineHeight,
      colorPrimary: style.colorPrimary,
      marginTopMm: style.marginTopMm,
      marginBottomMm: style.marginBottomMm,
      marginLeftMm: style.marginLeftMm,
      marginRightMm: style.marginRightMm,
    });
    return {
      ...result,
      presetId: style.id,
      presetName: style.name,
    };
  }

  // Wrap the body in a container with inline style — works for both editor preview
  // and PDF export. Page-level props (margins, header/footer) are applied at export time.
  const openingTag = `<div class="document-style-preset" data-preset-id="${style.id}" style="font-family: ${style.fontFamily}; font-size: ${style.fontSizeBase}pt; line-height: ${style.lineHeight}; color: ${style.colorPrimary};">`;
  const closingTag = `</div>`;

  let newHtml = context.htmlContent;
  const existingPresetMatch = newHtml.match(
    /<div class="document-style-preset"[^>]*>([\s\S]*)<\/div>\s*$/
  );
  if (existingPresetMatch) {
    newHtml = newHtml.replace(
      /<div class="document-style-preset"[^>]*>([\s\S]*)<\/div>\s*$/,
      `${openingTag}$1${closingTag}`
    );
  } else {
    newHtml = `${openingTag}${newHtml}${closingTag}`;
  }

  context.htmlContent = newHtml;

  return {
    success: true,
    presetId: style.id,
    presetName: style.name,
    appliedProps: {
      fontFamily: style.fontFamily,
      fontSizeBase: style.fontSizeBase,
      lineHeight: style.lineHeight,
      colorPrimary: style.colorPrimary,
      colorAccent: style.colorAccent,
    },
    pageProps: {
      marginTopMm: style.marginTopMm,
      marginBottomMm: style.marginBottomMm,
      marginLeftMm: style.marginLeftMm,
      marginRightMm: style.marginRightMm,
      pageNumbers: style.pageNumbers,
      includeToc: style.includeToc,
    },
    note:
      "Preset aplicado no corpo do contrato. Margens e cabeçalho/rodapé entram na próxima exportação PDF.",
  };
}

async function handleInsertImage(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const url = typeof input.url === "string" ? input.url : "";
  const alt = typeof input.alt === "string" ? input.alt : "";
  const width = typeof input.width === "number" ? input.width : 400;
  const alignment =
    typeof input.alignment === "string" &&
    ["left", "center", "right"].includes(input.alignment)
      ? (input.alignment as string)
      : "center";
  const insertAfter = typeof input.insertAfter === "string" ? input.insertAfter : null;

  if (!url || !alt) {
    return { error: "url e alt são obrigatórios" };
  }

  // Basic URL validation: must be http(s) or a relative path our app serves
  if (!/^(https?:\/\/|\/)/.test(url)) {
    return { error: "URL deve começar com http://, https:// ou /" };
  }

  // Google Docs path: insertInlineImage exige URL absoluta http(s).
  if (context.googleDocId) {
    if (!/^https?:\/\//.test(url)) {
      return {
        error: "Para Google Doc a imagem precisa ter URL absoluta — relative paths não são aceitos pela Docs API.",
      };
    }
    const widthPt = width * 0.75; // px → pt aproximado
    return googleInsertImage(context.googleDocId, url, {
      afterText: insertAfter || undefined,
      widthPt,
    });
  }

  const textAlignStyle =
    alignment === "center"
      ? "text-align: center;"
      : alignment === "right"
        ? "text-align: right;"
        : "text-align: left;";

  const imgBlock = `<p style="${textAlignStyle}"><img src="${url}" alt="${alt.replace(/"/g, "&quot;")}" class="editor-image rounded shadow-sm" style="max-width: ${width}px; height: auto;" /></p>`;

  if (insertAfter) {
    if (!context.htmlContent.includes(insertAfter)) {
      return {
        error:
          "O trecho 'insertAfter' não foi encontrado no contrato. Copie exatamente do texto.",
      };
    }
    context.htmlContent = context.htmlContent.replace(
      insertAfter,
      `${insertAfter}\n${imgBlock}`
    );
  } else {
    context.htmlContent = context.htmlContent + `\n${imgBlock}`;
  }

  return {
    success: true,
    url,
    alt,
    width,
    alignment,
    message: `Imagem inserida ${insertAfter ? "após o trecho selecionado" : "ao final do contrato"}.`,
  };
}

async function handleFindSimilarContracts(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const focus = typeof input.focus === "string" ? input.focus : undefined;
  const topK = Math.min(
    typeof input.topK === "number" && input.topK > 0 ? Math.floor(input.topK) : 3,
    10
  );

  try {
    const results = await findSimilarContracts(
      context.orgId,
      context.dataJson,
      context.templateModalidade || null,
      context.templateName || null,
      focus,
      topK
    );

    if (results.length === 0) {
      return {
        results: [],
        note:
          "Nenhum contrato similar encontrado. A organização ainda não tem memória para casos como este — você pode responder com sua formação geral.",
      };
    }

    return {
      results: results.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        summary: r.summary,
        fingerprint: r.fingerprint,
        acceptedSuggestions: r.acceptedSuggestions,
        rejectedSuggestionsCount: r.rejectedSuggestions.length,
        manualEditsSnippets: (r.manualEdits as Array<{ after?: string }>)
          .slice(0, 3)
          .map((e) => (e?.after || "").slice(0, 200)),
        similarity: r.similarity,
      })),
      total: results.length,
    };
  } catch (err) {
    if (err instanceof VoyageError) {
      return { error: `Falha na busca semântica: ${err.message}` };
    }
    console.error("[find_similar_contracts]", err);
    return { error: "Falha ao buscar contratos similares" };
  }
}

async function handleProposeNewClause(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const title = typeof input.title === "string" ? input.title : "";
  const content = typeof input.content === "string" ? input.content : "";
  const reason = typeof input.reason === "string" ? input.reason : "";
  const groupCode = typeof input.groupCode === "string" ? input.groupCode : null;
  const category = typeof input.category === "string" ? input.category : null;
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const tags = Array.isArray(input.tags) ? (input.tags as string[]) : [];

  if (!title || !content || !reason) {
    return { error: "title, content e reason são obrigatórios" };
  }

  // Rate limit: no more than 5 pending proposals per org
  const pendingCount = await prisma.clauseProposal.count({
    where: { orgId: context.orgId, status: "pending" },
  });
  if (pendingCount >= 5) {
    return {
      error:
        "Já existem 5 propostas de cláusula pendentes. Aguarde revisão antes de propor mais.",
      pendingCount,
    };
  }

  const proposal = await prisma.clauseProposal.create({
    data: {
      orgId: context.orgId,
      authorType: "ai",
      userId: null,
      title,
      content,
      groupCode,
      category,
      reason,
      evidence: evidence as object,
      tags,
    },
  });

  return {
    success: true,
    proposalId: proposal.id,
    status: "pending",
    reviewUrl: `/clauses/proposals`,
    message:
      "Proposta criada. Um humano precisa revisar antes de entrar na biblioteca — ela NÃO foi adicionada automaticamente.",
  };
}

async function handleProposeTemplateChange(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const templateId = typeof input.templateId === "string" ? input.templateId : "";
  const title = typeof input.title === "string" ? input.title : "";
  const reason = typeof input.reason === "string" ? input.reason : "";
  const hunks = Array.isArray(input.hunks) ? input.hunks : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  if (!templateId || !title || !reason || hunks.length === 0) {
    return { error: "templateId, title, reason e hunks são obrigatórios" };
  }

  // Verify template belongs to the org
  const template = await prisma.contractTemplate.findFirst({
    where: { id: templateId, orgId: context.orgId },
    select: { id: true, handlebarsSource: true },
  });
  if (!template) {
    return { error: "Template não encontrado ou não pertence à organização" };
  }

  // Validate that each hunk's `before` actually exists in the template source
  // so the suggestion is applicable.
  const source = template.handlebarsSource;
  const validHunks: Array<{ before: string; after: string; contextBefore?: string; contextAfter?: string }> = [];
  for (const hunk of hunks) {
    if (!hunk || typeof hunk !== "object") continue;
    const h = hunk as Record<string, unknown>;
    const before = typeof h.before === "string" ? h.before : "";
    const after = typeof h.after === "string" ? h.after : "";
    if (!before || !after) continue;
    if (!source.includes(before)) {
      return {
        error: `Hunk inválido: o trecho 'before' não existe no template atual. Trecho: "${before.slice(0, 100)}..."`,
      };
    }
    validHunks.push({
      before,
      after,
      contextBefore: typeof h.contextBefore === "string" ? h.contextBefore : undefined,
      contextAfter: typeof h.contextAfter === "string" ? h.contextAfter : undefined,
    });
  }

  if (validHunks.length === 0) {
    return { error: "Nenhum hunk válido após validação" };
  }

  // Rate limit: no more than 5 pending suggestions per template
  const pendingCount = await prisma.templateSuggestion.count({
    where: { templateId, status: "pending" },
  });
  if (pendingCount >= 5) {
    return {
      error:
        "Já existem 5 sugestões pendentes para este template. Aguarde revisão antes de propor mais.",
    };
  }

  const suggestion = await prisma.templateSuggestion.create({
    data: {
      templateId,
      orgId: context.orgId,
      authorType: "ai",
      userId: null,
      title,
      reason,
      diffHunks: validHunks as object,
      evidence: evidence as object,
    },
  });

  return {
    success: true,
    suggestionId: suggestion.id,
    status: "pending",
    reviewUrl: `/templates/${templateId}/suggestions`,
    hunksCount: validHunks.length,
    message:
      "Sugestão criada. O template NÃO foi alterado — um admin precisa revisar e aprovar.",
  };
}

async function knowledgeBaseKeywordFallback(
  query: string,
  category: string | undefined,
  topK: number,
  orgId: string,
  reason: string
): Promise<Record<string, unknown>> {
  const rows = await prisma.knowledgeItem.findMany({
    where: {
      orgId,
      ...(category ? { category } : {}),
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
    },
    take: topK,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      tags: true,
      source: true,
    },
  });
  return {
    results: rows.map((r) => ({
      ...r,
      content: r.content.slice(0, 800),
    })),
    mode: "keyword_fallback",
    note: `Busca por palavra-chave (recall inferior). Motivo: ${reason}`,
  };
}

async function handleQueryKnowledgeBase(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const query = typeof input.query === "string" ? input.query : "";
  const category = typeof input.category === "string" ? input.category : undefined;
  const topK = Math.min(
    typeof input.topK === "number" && input.topK > 0 ? Math.floor(input.topK) : 5,
    10
  );

  if (!query) {
    return { error: "query é obrigatório" };
  }

  if (!isEmbeddingsConfigured()) {
    return knowledgeBaseKeywordFallback(
      query,
      category,
      topK,
      context.orgId,
      "VOYAGE_API_KEY não configurada"
    );
  }

  try {
    const queryVec = await embedOne(query, "query", {
      orgId: context.orgId,
      contractId: context.contractId,
      operation: "embed_query",
    });
    const vecLiteral = toPgVector(queryVec);

    // Raw SQL with pgvector cosine similarity; filter by org and optional category
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        title: string;
        content: string;
        category: string;
        tags: string[];
        source: string | null;
        similarity: number;
      }>
    >(
      `
      SELECT
        id,
        title,
        content,
        category,
        tags,
        source,
        1 - (embedding <=> $1::vector) AS similarity
      FROM "KnowledgeItem"
      WHERE "orgId" = $2
        AND embedding IS NOT NULL
        ${category ? 'AND category = $3' : ''}
      ORDER BY embedding <=> $1::vector
      LIMIT ${topK}
      `,
      vecLiteral,
      context.orgId,
      ...(category ? [category] : [])
    );

    return {
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content.slice(0, 800),
        category: r.category,
        tags: r.tags,
        source: r.source,
        similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
      })),
      mode: "semantic",
      topK,
    };
  } catch (err) {
    // Em vez de retornar {error} e gastar o turn do agente esperando um
    // fallback explícito (que ele às vezes não faz), caímos no keyword
    // fallback que já é coded path. UX win: stream sempre devolve algo útil
    // mesmo com Voyage 429 ou pgvector parcialmente quebrado.
    const reason =
      err instanceof VoyageError
        ? `Voyage API: ${err.message}`
        : err instanceof Error
        ? err.message.slice(0, 160)
        : String(err).slice(0, 160);
    console.error("[query_knowledge_base] fallback acionado:", reason);
    try {
      const fallback = await knowledgeBaseKeywordFallback(
        query,
        category,
        topK,
        context.orgId,
        reason
      );
      return fallback;
    } catch (fallbackErr) {
      console.error("[query_knowledge_base] fallback também falhou:", fallbackErr);
      return {
        error: `query_knowledge_base falhou: ${reason}`,
        fallback_suggestion:
          "Busca semântica e fallback ILIKE ambos falharam — verifique conexão com Postgres.",
      };
    }
  }
}

async function handleAnalyzeContradictions(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const focus = typeof input.focus === "string" ? input.focus : undefined;
  const scope = typeof input.scope === "string" ? input.scope : undefined;

  // Run deterministic checks first
  const findings = quickChecks(context.dataJson, context.htmlContent);

  // Add lightweight semantic checks specific to the contract structure
  const html = scope || context.htmlContent;
  const semanticFindings: Array<{
    severity: "info" | "warning" | "error";
    category: string;
    message: string;
    selectedText: string;
    suggestedFix?: string;
  }> = [];

  // Check for mutually exclusive clause pairs
  const mutuallyExclusive: Array<[RegExp, RegExp, string]> = [
    [
      /irretratabilidade|irretrata[vb]el/i,
      /direito de arrependimento|arrependimento/i,
      "Contrato afirma irretratabilidade mas menciona direito de arrependimento — cláusulas mutuamente exclusivas",
    ],
    [
      /foro\s+(eleito|escolhido|de\s+elei[cç][ãa]o)/i,
      /arbitragem\s+(obrigat[óo]ria|exclusiva|v[íi]nculativa)/i,
      "Contrato elege foro judicial mas também obriga arbitragem — conflito de jurisdição",
    ],
  ];

  for (const [pattern1, pattern2, message] of mutuallyExclusive) {
    const m1 = pattern1.exec(html);
    const m2 = pattern2.exec(html);
    if (m1 && m2) {
      semanticFindings.push({
        severity: "warning",
        category: "reference",
        message,
        selectedText: m1[0],
        suggestedFix: "Escolha uma única forma de resolução de conflitos.",
      });
    }
  }

  const allFindings = [...findings, ...semanticFindings];

  return {
    findings: allFindings,
    focus: focus || "contract_full",
    scopeProvided: !!scope,
    totalFindings: allFindings.length,
    errorCount: allFindings.filter((f) => f.severity === "error").length,
    warningCount: allFindings.filter((f) => f.severity === "warning").length,
    infoCount: allFindings.filter((f) => f.severity === "info").length,
  };
}

async function handleAddComment(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const selectedText = typeof input.selectedText === "string" ? input.selectedText : "";
  const text = typeof input.text === "string" ? input.text : "";
  const severity =
    typeof input.severity === "string" &&
    ["info", "warning", "error"].includes(input.severity)
      ? (input.severity as string)
      : "info";

  if (!selectedText || !text) {
    return { error: "selectedText e text são obrigatórios" };
  }

  const { randomUUID } = await import("node:crypto");
  const anchorId = randomUUID();

  // Google Docs path: cria comment via Drive Comments API e espelha localmente.
  // Anti-alucinação fica em createAnchoredComment (varre o doc por substring).
  if (context.googleDocId) {
    const result = await googleAddComment(context.googleDocId, selectedText, text);
    if (result.error) return { error: result.error };
    await prisma.contractComment.create({
      data: {
        contractId: context.contractId,
        userId: null,
        authorName: "Assistente IA",
        authorType: "ai",
        text,
        anchorId,
        selectedText,
        severity,
        googleCommentId: typeof result.commentId === "string" ? result.commentId : null,
      },
    });
    return {
      success: true,
      anchorId,
      severity,
      googleCommentId: result.commentId,
      message: `Comentário (${severity}) criado no Google Doc.`,
    };
  }

  // Verify the selected text exists in the current HTML to avoid hallucinated anchors
  if (!context.htmlContent.includes(selectedText)) {
    return {
      error:
        "O trecho selecionado não foi encontrado no contrato. Copie exatamente do texto atual.",
    };
  }

  await prisma.contractComment.create({
    data: {
      contractId: context.contractId,
      userId: null,
      authorName: "Assistente IA",
      authorType: "ai",
      text,
      anchorId,
      selectedText,
      severity,
    },
  });

  return {
    success: true,
    anchorId,
    severity,
    message: `Comentário (${severity}) adicionado ao trecho: "${selectedText.slice(0, 80)}${selectedText.length > 80 ? "…" : ""}"`,
  };
}

async function handleQueryClauses(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = {
    orgId: context.orgId,
    status: "approved",
  };
  if (input.category) where.category = input.category;
  if (input.groupCode) where.groupCode = input.groupCode;
  if (input.isVariable !== undefined) where.isVariable = input.isVariable;

  const clauses = await prisma.clause.findMany({
    where: {
      ...where,
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search as string, mode: "insensitive" as const } },
              { content: { contains: input.search as string, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ usageCount: "desc" }, { category: "asc" }],
    take: 15,
  });

  return {
    found: clauses.length,
    clauses: clauses.map((c) => ({
      id: c.id,
      category: c.category,
      subcategory: c.subcategory,
      title: c.title,
      content: c.content.substring(0, 500),
      tags: c.tags,
      usageCount: c.usageCount,
      groupCode: c.groupCode,
      agentNotes: c.agentNotes,
    })),
  };
}

async function handleQueryTemplates(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const templates = await prisma.contractTemplate.findMany({
    where: {
      orgId: context.orgId,
      status: "active",
      ...(input.schemaType ? { schemaType: input.schemaType as string } : {}),
    },
    select: { id: true, name: true, description: true, version: true, schemaType: true, isDefault: true, modalidade: true },
  });

  return { templates };
}

async function handleExplainClause(
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // This tool doesn't query DB - the AI model itself generates the explanation
  // Return the text back so the model can explain it in its response
  return {
    clauseText: input.clauseText,
    instruction: "Explique esta cláusula em linguagem simples para leigos, citando a base legal se aplicável.",
  };
}

async function handleEditSection(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const target = input.target as string;
  const replacement = input.replacement as string;

  if (context.googleDocId) {
    return googleEditSection(context.googleDocId, target, replacement);
  }

  if (!context.htmlContent.includes(target)) {
    return {
      success: false,
      error: "Trecho não encontrado no contrato. Verifique o texto exato.",
    };
  }

  context.htmlContent = context.htmlContent.replace(target, replacement);

  return {
    success: true,
    message: `Trecho substituído com sucesso (${target.length} → ${replacement.length} caracteres)`,
    preview: replacement.substring(0, 200),
  };
}

async function handleUpdateData(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const patch = input.patch as Record<string, unknown>;
  if (!patch || typeof patch !== "object") {
    return { success: false, error: "Patch inválido" };
  }

  context.dataJson = deepMerge(context.dataJson, patch);

  if (context.googleDocId) {
    // Em modo Google Docs o doc é a fonte de verdade do texto — re-renderizar
    // o template sobrescreveria edições humanas. dataJson é atualizada para
    // export futuro e quick checks; o agente deve usar `edit_contract_section`
    // para aplicar a mudança no texto visível.
    return {
      success: true,
      updatedFields: Object.keys(patch),
      message: `Dados atualizados em dataJson. Use edit_contract_section para refletir no Google Doc.`,
      requiresExplicitEdit: true,
    };
  }

  // Sem GDoc: dataJson é só persistido, sem texto visível pra atualizar.
  // (Caminho legado/raro — todos contratos novos têm googleDocId.)
  const updatedFields = Object.keys(patch);
  return {
    success: true,
    updatedFields,
    message: `Dados atualizados: ${updatedFields.join(", ")}. Use edit_contract_section pra refletir no doc.`,
  };
}

/**
 * Creates a ContractSuggestion row and inserts <ins>/<del> markup into the
 * contract HTML so the SuggestionMark extension picks it up and the
 * SuggestionsToolbar shows the pending count. The mark's suggestionId
 * attribute ties the DOM node back to the DB row for accept/reject flow.
 */
async function handleProposeSuggestion(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const target = typeof input.target === "string" ? input.target : "";
  const replacement = typeof input.replacement === "string" ? input.replacement : "";
  const reason = typeof input.reason === "string" ? input.reason : "";
  let typeIn =
    typeof input.type === "string" && ["replacement", "insertion", "deletion"].includes(input.type)
      ? (input.type as "replacement" | "insertion" | "deletion")
      : "replacement";

  if (!target || !target.trim()) {
    return { success: false, error: "target obrigatório" };
  }
  if (typeIn !== "deletion" && (!replacement || !replacement.trim())) {
    return { success: false, error: "replacement obrigatório para insertion/replacement" };
  }
  if (!reason || !reason.trim()) {
    return { success: false, error: "reason obrigatório" };
  }

  // Agents occasionally pick type="insertion" when they mean to REPLACE a piece
  // of text with new wording. Insertion semantically keeps `target` and appends
  // `replacement` after it, resulting in duplicated content. If target and
  // replacement are both present, differ, and the user clearly wants a
  // substitution, override to "replacement" so we emit a <del>/<ins> pair.
  if (
    typeIn === "insertion" &&
    target.trim() &&
    replacement.trim() &&
    target.trim() !== replacement.trim()
  ) {
    typeIn = "replacement";
  }

  if (!context.htmlContent.includes(target)) {
    return {
      success: false,
      error:
        "Trecho 'target' não encontrado no contrato. Copie o texto exato do HTML atual.",
    };
  }

  // Dedupe guard: skip if there's already a pending suggestion with the same
  // originalText on this contract (avoids creating multiple identical proposals
  // when the user retries or asks twice).
  const existing = await prisma.contractSuggestion.findFirst({
    where: {
      contractId: context.contractId,
      originalText: target,
      status: "pending",
    },
    select: { id: true },
  });
  if (existing) {
    return {
      success: true,
      suggestionId: existing.id,
      message: "Já existe uma sugestão pendente idêntica — reutilizando.",
      duplicate: true,
    };
  }

  // Google Docs path: cria comment ancorado no Drive como suggestion.
  // Aceitar/rejeitar via PATCH /suggestions/[id] aplica `replaceAllText` etc.
  let googleCommentId: string | null = null;
  if (context.googleDocId) {
    const result = await googleProposeSuggestion(context.googleDocId, {
      type: typeIn,
      selectedText: target,
      newText: replacement,
      reason,
    });
    if (result.error) return result;
    googleCommentId = typeof result.googleCommentId === "string" ? result.googleCommentId : null;
  }

  const suggestion = await prisma.contractSuggestion.create({
    data: {
      contractId: context.contractId,
      userId: null,
      authorType: "ai",
      type: typeIn,
      suggestionId: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      originalText: target,
      newText: replacement,
      reason,
      status: "pending",
      googleSuggestionId: googleCommentId,
    },
  });

  if (!context.googleDocId) {
    // Build the track-change markup. SuggestionMark in the editor reads
    // data-suggestion-id to key accept/reject actions back to this row.
    const attrs = `data-suggestion-id="${suggestion.suggestionId}" data-type="${typeIn}" data-author="ai"`;
    let markup: string;
    if (typeIn === "deletion") {
      markup = `<del ${attrs}>${target}</del>`;
    } else if (typeIn === "insertion") {
      markup = `${target}<ins ${attrs}>${replacement}</ins>`;
    } else {
      markup = `<del ${attrs}>${target}</del><ins ${attrs}>${replacement}</ins>`;
    }
    context.htmlContent = context.htmlContent.replace(target, markup);
  }

  return {
    success: true,
    suggestionId: suggestion.id,
    suggestionAnchorId: suggestion.suggestionId,
    type: typeIn,
    googleCommentId,
    message: context.googleDocId
      ? `Sugestão criada como comment no Google Doc.`
      : `Sugestão criada em modo track changes. Usuário pode aceitar ou rejeitar na barra de revisão do editor.`,
  };
}

async function handleInsertClause(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const clauseId = input.clauseId as string;

  const clause = await prisma.clause.findUnique({ where: { id: clauseId } });
  if (!clause) {
    return { success: false, error: "Cláusula não encontrada" };
  }

  // Check if already in contract
  const existing = context.activeClauses.find((c) => c.clauseId === clauseId);
  if (existing) {
    return { success: false, error: `Cláusula "${clause.title}" já está no contrato` };
  }

  // Add to ContractClause
  const maxPos = Math.max(0, ...context.activeClauses.map((c) => c.position));
  await prisma.contractClause.create({
    data: {
      contractId: context.contractId,
      clauseId: clause.id,
      position: maxPos + 1,
      isActive: true,
    },
  });

  // Increment usage count
  await prisma.clause.update({
    where: { id: clauseId },
    data: { usageCount: { increment: 1 } },
  });

  // Render clause content with contract data
  const renderedClause = renderContratoHTML(clause.content, context.dataJson);
  const clauseHtml = `\n<div class="clausula-inserida" data-clause-id="${clause.id}" data-group="${clause.groupCode || ""}">\n${renderedClause}\n</div>\n`;

  // Google Docs path: insere via Docs API. Slots HTML não existem no doc nativo;
  // usa `afterSection` se fornecido, senão append no fim.
  if (context.googleDocId) {
    const afterText = typeof input.afterSection === "string" ? input.afterSection : undefined;
    const result = await googleInsertClause(context.googleDocId, renderedClause, {
      afterText,
      atEnd: !afterText,
    });
    if (!result.error) {
      context.activeClauses.push({
        id: "",
        clauseId: clause.id,
        title: clause.title,
        category: clause.category,
        position: maxPos + 1,
        isActive: true,
      });
      return {
        success: true,
        clauseTitle: clause.title,
        category: clause.category,
        message: `Cláusula "${clause.title}" inserida no Google Doc`,
      };
    }
    return result;
  }

  // Try to find a CLAUSE_SLOT matching the clause's groupCode
  let inserted = false;
  if (clause.groupCode) {
    const slotPattern = `<!-- CLAUSE_SLOT:${clause.groupCode} -->`;
    const slotIndex = context.htmlContent.indexOf(slotPattern);
    if (slotIndex >= 0) {
      // Insert AFTER the slot comment
      const insertAt = slotIndex + slotPattern.length;
      context.htmlContent =
        context.htmlContent.substring(0, insertAt) +
        clauseHtml +
        context.htmlContent.substring(insertAt);
      inserted = true;
    }
  }

  // Fallback: try afterSection parameter
  if (!inserted && input.afterSection) {
    const sectionPattern = input.afterSection as string;
    const sectionIndex = context.htmlContent.indexOf(sectionPattern);
    if (sectionIndex >= 0) {
      // Find end of the section's parent element
      const afterSection = context.htmlContent.indexOf("</", sectionIndex + sectionPattern.length);
      if (afterSection >= 0) {
        const closingTagEnd = context.htmlContent.indexOf(">", afterSection) + 1;
        context.htmlContent =
          context.htmlContent.substring(0, closingTagEnd) +
          clauseHtml +
          context.htmlContent.substring(closingTagEnd);
        inserted = true;
      }
    }
  }

  // Final fallback: insert before the last </div>
  if (!inserted) {
    const insertPoint = context.htmlContent.lastIndexOf("</div>");
    if (insertPoint > 0) {
      context.htmlContent =
        context.htmlContent.substring(0, insertPoint) +
        clauseHtml +
        context.htmlContent.substring(insertPoint);
    }
  }

  context.activeClauses.push({
    id: "", clauseId: clause.id, title: clause.title,
    category: clause.category, position: maxPos + 1, isActive: true,
  });

  return {
    success: true,
    clauseTitle: clause.title,
    category: clause.category,
    message: `Cláusula "${clause.title}" inserida no contrato`,
  };
}

async function handleRemoveClause(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const clauseId = input.clauseId as string;

  const link = await prisma.contractClause.findFirst({
    where: { contractId: context.contractId, clauseId },
    include: { clause: { select: { title: true } } },
  });

  if (!link) {
    return { success: false, error: "Cláusula não está vinculada a este contrato" };
  }

  // Google Docs path: remove o trecho da cláusula do doc também.
  if (context.googleDocId) {
    const clauseFull = await prisma.clause.findUnique({ where: { id: clauseId } });
    if (clauseFull) {
      const renderedClause = renderContratoHTML(clauseFull.content, context.dataJson);
      // Apenas a primeira linha não-vazia como âncora — texto completo seria
      // frágil pra indexOf por ter sido reformatado pelo Google Docs.
      const anchor = renderedClause
        .replace(/<[^>]+>/g, "")
        .split("\n")
        .map((s) => s.trim())
        .find((s) => s.length >= 30);
      if (anchor) {
        await googleRemoveClause(context.googleDocId, anchor);
      }
    }
  }

  await prisma.contractClause.delete({ where: { id: link.id } });
  context.activeClauses = context.activeClauses.filter((c) => c.clauseId !== clauseId);

  return {
    success: true,
    message: `Cláusula "${link.clause.title}" removida do contrato`,
  };
}

async function handleValidateContract(
  context: AgentContext
): Promise<Record<string, unknown>> {
  // Local validations
  const issues: ValidationIssue[] = validateContractData(context.dataJson);

  // Check for empty fields in rendered HTML
  const emptyPatterns = [
    { pattern: /de\s+%/g, message: "Percentual vazio (ex: 'de %' sem valor)" },
    { pattern: /R\$\s+0,00/g, message: "Valor zerado no contrato" },
    { pattern: /\(\)/g, message: "Parênteses vazios no contrato" },
    { pattern: /em\s+\/\//g, message: "Data vazia (formato '//')" },
  ];

  for (const { pattern, message } of emptyPatterns) {
    const matches = context.htmlContent.match(pattern);
    if (matches) {
      issues.push({
        field: "htmlContent",
        severity: "warning",
        message: `${message} - ${matches.length} ocorrência(s)`,
      });
    }
  }

  // Check for missing accents (common issues)
  const accentIssues = [
    { wrong: /\bpreco\b/gi, correct: "preço" },
    { wrong: /\bimovel\b/gi, correct: "imóvel" },
    { wrong: /\bclausula\b/gi, correct: "cláusula" },
    { wrong: /\btitulo\b/gi, correct: "título" },
    { wrong: /\bnumero\b/gi, correct: "número" },
  ];

  for (const { wrong, correct } of accentIssues) {
    if (wrong.test(context.htmlContent)) {
      issues.push({
        field: "ortografia",
        severity: "warning",
        message: `Palavra sem acento encontrada. Use "${correct}" ao invés da versão sem acento.`,
      });
    }
  }

  return {
    totalIssues: issues.length,
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
    info: issues.filter((i) => i.severity === "info"),
  };
}

async function handleSuggestImprovements(
  input: Record<string, unknown>,
  context: AgentContext
): Promise<Record<string, unknown>> {
  const suggestions: ClauseSuggestion[] = [];
  const data = context.dataJson;
  const pagamento = data.pagamento as Record<string, unknown> | undefined;

  // Check which clause bank groups are linked via DB
  const linkedClauses = await prisma.clause.findMany({
    where: {
      id: { in: context.activeClauses.map((c) => c.clauseId) },
    },
    select: { groupCode: true, title: true },
  });
  const linkedGroups = new Set(linkedClauses.map((c) => c.groupCode).filter(Boolean));

  const isFinanciamento = (pagamento?.alienacao_fiduciaria as number) > 0;
  const hasFGTS = (pagamento?.fgts as number) > 0;
  const vendedores = data.vendedores as Array<Record<string, unknown>> | undefined;
  const multipleVendedores = vendedores && vendedores.length > 1;

  // Financing -> G4 is MANDATORY
  if (isFinanciamento && !linkedGroups.has("G4")) {
    suggestions.push({
      category: "titulo",
      title: "Cláusulas de Financiamento (Grupo G4) - OBRIGATÓRIO",
      reason: "Contrato com financiamento bancário DEVE ter as cláusulas do Grupo G4: prazo de 45 dias úteis, diferença de valor liberado, suspensão por nota de exigência. Use query_clauses com groupCode='G4'.",
      importance: "critical",
    });
  }

  // Financing -> G3 condition resolutiva
  if (isFinanciamento) {
    const hasNonApprovalClause = linkedClauses.some(
      (c) => c.title?.includes("Não Obtenção de Financiamento")
    );
    if (!hasNonApprovalClause) {
      suggestions.push({
        category: "penalidades",
        title: "Condição Resolutiva por Não Obtenção de Financiamento (G3)",
        reason: "OBRIGATÓRIO em financiamento: restituição integral sem penalidades se financiamento for negado. Use query_clauses com groupCode='G3'.",
        importance: "critical",
      });
    }
  }

  // Multiple sellers -> G1 proportional payment
  if (multipleVendedores && !linkedGroups.has("G1")) {
    suggestions.push({
      category: "preco",
      title: "Pagamento Proporcional em Contas Indicadas (G1)",
      reason: "Pluralidade de vendedores detectada. Recomenda-se cláusula de pagamento proporcional com indicação de contas. Use query_clauses com groupCode='G1'.",
      importance: "high",
    });
  }

  // FGTS -> G6 FGTS clause
  if (hasFGTS) {
    const hasFGTSClause = linkedClauses.some(
      (c) => c.title?.includes("FGTS")
    );
    if (!hasFGTSClause) {
      suggestions.push({
        category: "preco",
        title: "Pagamento via FGTS (G6)",
        reason: "FGTS > 0 no pagamento. Inserir cláusula com prazo de habilitação junto à CEF (Lei 8.036/1990). Use query_clauses com groupCode='G6'.",
        importance: "high",
      });
    }
  }

  // Seller is PJ partner -> G6 PJ declaration
  if (vendedores) {
    const hasSocioPJ = vendedores.some((v) => v.socio_pj === true);
    if (hasSocioPJ) {
      const hasPJClause = linkedClauses.some(
        (c) => c.title?.includes("Pessoa Jurídica")
      );
      if (!hasPJClause) {
        suggestions.push({
          category: "foro",
          title: "Declaração de Sócio de Pessoa Jurídica (G6)",
          reason: "Vendedor é sócio de PJ. Necessária declaração de ausência de pendências judiciais na empresa para proteção contra fraude a credores.",
          importance: "high",
        });
      }
    }
  }

  // Occupied property -> tenant preference
  if (data.ocupacao === "ocupado-terceiro") {
    suggestions.push({
      category: "posse",
      title: "Direito de Preferência do Locatário",
      reason: "Lei 8.245/91, art. 27 exige notificação ao locatário. Sem isso, a venda pode ser anulada.",
      importance: "critical",
    });
  }

  // Outstanding debt -> clearance clause
  if ((data.saldo_devedor as number) > 0) {
    suggestions.push({
      category: "titulo",
      title: "Quitação de Alienação Fiduciária antes da Escritura",
      reason: "Imóvel tem saldo devedor. Vendedor deve quitar antes da transferência de propriedade.",
      importance: "high",
    });
  }

  // Defects disclosed -> repair deadline
  const vicios = data.vicios as Record<string, unknown> | undefined;
  if (vicios?.descricao_reparar) {
    suggestions.push({
      category: "compromisso",
      title: "Prazo e Penalidade para Reparo de Vícios",
      reason: "Vícios foram declarados para reparo, mas não há prazo nem penalidade por descumprimento.",
      importance: "high",
    });
  }

  // No commission -> check if intentional
  const comissao = data.comissao as Record<string, unknown> | undefined;
  if (!comissao?.valor || (comissao.valor as number) === 0) {
    suggestions.push({
      category: "comissao",
      title: "Cláusula de Isenção de Comissão",
      reason: "Comissão não definida. Se intencional, formalize a isenção para evitar cobranças futuras.",
      importance: "medium",
    });
  }

  return {
    totalSuggestions: suggestions.length,
    suggestions,
  };
}

async function handleExtractDocument(
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const attachmentId = input.attachmentId as string;

  // Try FormAttachment first, then DealAttachment
  let attachment: { url: string; category: string | null; mime: string } | null = null;

  const formAtt = await prisma.formAttachment.findUnique({ where: { id: attachmentId } });
  if (formAtt) {
    attachment = { url: formAtt.url, category: formAtt.category, mime: formAtt.mime };
  } else {
    const dealAtt = await prisma.dealAttachment.findUnique({ where: { id: attachmentId } });
    if (dealAtt) {
      attachment = { url: dealAtt.url, category: dealAtt.category, mime: dealAtt.mime };
    }
  }

  if (!attachment) {
    return { success: false, error: "Anexo não encontrado" };
  }

  // For now, return info about the attachment - actual OCR requires image buffer
  // In production, fetch the file from URL and pass to extractDocumentData()
  return {
    success: true,
    attachmentId,
    category: attachment.category,
    mime: attachment.mime,
    message: "Documento identificado. Use a API de OCR para extrair os dados.",
    instruction: "Para extração completa, o documento precisa ser processado via endpoint dedicado /api/documents/extract-ai",
  };
}
