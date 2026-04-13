import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { validateContractData } from "./validators";
import { extractDocumentData } from "./ocr";
import { quickChecks } from "./quickChecks";
import { embedOne, toPgVector, VoyageError, isEmbeddingsConfigured } from "./embeddings";
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
    default:
      return { error: `Tool desconhecida: ${toolName}` };
  }
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
    // Fallback: keyword search via PostgreSQL ILIKE when embeddings are off
    const rows = await prisma.knowledgeItem.findMany({
      where: {
        orgId: context.orgId,
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
      results: rows,
      mode: "keyword_fallback",
      note: "VOYAGE_API_KEY não configurada — busca por palavra-chave (recall inferior)",
    };
  }

  try {
    const queryVec = await embedOne(query, "query");
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
    if (err instanceof VoyageError) {
      return {
        error: `Falha na busca semântica: ${err.message}`,
        fallback_suggestion: "Tente reformular a query ou verifique VOYAGE_API_KEY",
      };
    }
    throw err;
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

  // Verify the selected text exists in the current HTML to avoid hallucinated anchors
  if (!context.htmlContent.includes(selectedText)) {
    return {
      error:
        "O trecho selecionado não foi encontrado no contrato. Copie exatamente do texto atual.",
    };
  }

  const { randomUUID } = await import("node:crypto");
  const anchorId = randomUUID();

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

  // Re-render HTML with updated data
  context.htmlContent = renderContratoHTML(context.templateSource, context.dataJson);

  const updatedFields = Object.keys(patch);
  return {
    success: true,
    updatedFields,
    message: `Dados atualizados: ${updatedFields.join(", ")}. Contrato re-renderizado.`,
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
