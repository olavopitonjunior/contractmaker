/**
 * Helpers compartilhados pra mapear tool names → ações do ChangeLog e
 * resumos human-readable. Reusados pelo agent.ts legacy e pelos
 * especialistas do graph multi-agente (F1+).
 */

/** Output tipado de um tool handler — convenção: { error } em falha,
 *  { success, ...payload } em sucesso. */
export interface ToolOutput {
  success?: boolean;
  verified?: boolean;
  error?: string;
  [k: string]: unknown;
}

/** Tools que MUTAM o contrato (HTML/dataJson/comments/clauses). */
export const EDIT_TOOL_NAMES = new Set([
  "edit_contract_section",
  "update_contract_data",
  "insert_clause",
  "remove_clause",
  "apply_style_preset",
  "insert_image",
]);

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_NAMES.has(name);
}

/** Map tool name → action enum do ContractChangeLog. */
export function mapToolToAction(toolName: string): string {
  const map: Record<string, string> = {
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

/** Resumo human-readable do tool_use baseado no input. */
export function buildToolSummary(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "edit_contract_section":
      return `Editou seção do contrato: substituiu ${(input.target as string)?.length || 0} caracteres`;
    case "update_contract_data":
      return `Atualizou dados: ${Object.keys(input.patch as Record<string, unknown> || {}).join(", ")}`;
    case "insert_clause": {
      const id = (input.knowledgeItemId || input.clauseId) as string | undefined;
      return `Inseriu cláusula da biblioteca${id ? ` (id ${id})` : ""}`;
    }
    case "remove_clause": {
      const id = (input.knowledgeItemId || input.clauseId) as string | undefined;
      return `Removeu cláusula${id ? ` (id ${id})` : ""}`;
    }
    case "validate_contract":
      return "Executou validação completa do contrato";
    case "suggest_improvements":
      return `Gerou sugestões de melhoria${input.focus ? ` (foco: ${input.focus})` : ""}`;
    case "extract_document_data":
      return `Extraiu dados do documento ${input.attachmentId}`;
    case "query_knowledge_base":
      return `Consultou base${input.query ? `: "${(input.query as string).slice(0, 60)}"` : ""}${input.category ? ` [${input.category}]` : ""}`;
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

/** Resumo de tool_result pra emitir como AgentEvent.summary. */
export function summarizeToolResult(name: string, output: ToolOutput): string {
  if (output.error) return String(output.error).slice(0, 200);
  if (name === "edit_contract_section" && typeof output.occurrencesChanged === "number") {
    return `${output.occurrencesChanged} ocorrência(s) substituída(s)`;
  }
  if (name === "insert_clause" && output.success) return "Cláusula inserida";
  if (name === "remove_clause" && output.success) return "Cláusula removida";
  if (output.success) return "OK";
  return "Concluído";
}
