/**
 * EditorAgent — aplica edições no contrato (HTML ou Google Docs).
 * Modelo: Sonnet 4.6 (writes complexos exigem capacidade jurídica).
 * Max 3 iterações.
 *
 * Tools (Group 2 + auxiliares):
 *   - edit_contract_section / update_contract_data / propose_suggestion
 *   - insert_clause / remove_clause
 *   - apply_style_preset / insert_image
 *   - add_comment
 *
 * Cada tool_use passa por Sentinel ANTES da execução. Edits em GDocs
 * têm snapshot htmlBefore/htmlAfter capturado pelo runner.
 */

import { AGENT_TOOLS } from "../tools";
import { SONNET_MODEL } from "../shared/anthropic-client";
import { runSpecialist, type ToolUseGuard } from "../shared/specialist-runner";
import { applyPolicy } from "../sentinel/middleware";
import { EDITOR_SYSTEM_PROMPT } from "./prompts";
import type { OrchestratorState, SpecialistOutput } from "../orchestrator/state";

const EDITOR_TOOL_NAMES = new Set([
  "edit_contract_section",
  "update_contract_data",
  "propose_suggestion",
  "insert_clause",
  "remove_clause",
  "apply_style_preset",
  "insert_image",
  "add_comment",
  // F4: Editor consulta crosscheck antes de propor aditamento — passa por
  // Sentinel (read-only, sem write contra contrato).
  "cross_check_certidoes",
  // F5: propose_plan permite Editor responder a intents edit_multi sem
  // cair no streamContractAgent legacy. ChatPlan é criado com a session
  // do graph (sessionId + pendingAssistantMessageId injetados pelo runner).
  "propose_plan",
]);

const EDITOR_TOOLS = AGENT_TOOLS.filter((t) => EDITOR_TOOL_NAMES.has(t.name));

export async function runEditor(state: OrchestratorState): Promise<SpecialistOutput> {
  if (!state.contractContext) {
    throw new Error("runEditor: contractContext não foi carregado");
  }

  const guard: ToolUseGuard = async ({ name, input }) => {
    const decision = await applyPolicy({ tool: name, input }, state);
    if (decision.decision === "approve") return { allowed: true };
    return {
      allowed: false,
      reason: decision.reason,
      ruleId: decision.ruleId,
    };
  };

  const userPrompt = buildEditorPrompt(state);

  return runSpecialist({
    agentName: "editor",
    model: SONNET_MODEL,
    systemPrompt: EDITOR_SYSTEM_PROMPT,
    tools: EDITOR_TOOLS,
    maxIterations: 3,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    toolGuard: guard,
    captureSnapshots: true,
    forceToolUse: state.intent === "edit_simple",
    sessionId: state.sessionId,
  });
}

function buildEditorPrompt(state: OrchestratorState): string {
  const expert = state.expertContext ? `${state.expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";
  const ctx = state.contractContext!;
  const truncated = ctx.htmlContent.length > 8000;
  const htmlSlice = ctx.htmlContent.slice(0, 8000);
  const contentLabel = ctx.googleDocId
    ? "TEXTO ATUAL DO CONTRATO (Google Doc — sem markup HTML)"
    : "HTML ATUAL DO CONTRATO";

  const intentHint =
    state.intent === "edit_multi"
      ? `\n\n⚠️ INTENT=edit_multi: a mensagem do usuário envolve MÚLTIPLAS edições encadeadas. Você DEVE chamar \`propose_plan\` primeiro com a lista completa de steps (reads + writes), ANTES de qualquer write direto. O sistema vai persistir ChatPlan pendente e o usuário aprova via PlanCard na UI. Writes diretos sem propose_plan em edit_multi são bug.`
      : "";

  // F4 iteração 2026-05-17 — informa o Editor sobre o estado de assinatura
  // pra decidir entre edit-no-draft e create-aditamento. signingState é
  // populado pelo loadContextNode no graph antes da invocação.
  const signingState = (state as unknown as { signingState?: { hasSignedContract: boolean; originalContractId: string | null } }).signingState;
  const signingHint = signingState
    ? signingState.hasSignedContract
      ? `\n\n🔒 ESTADO DE ASSINATURA: contrato ORIGINAL JÁ ASSINADO (envelope closed, original=${signingState.originalContractId}). Qualquer alteração que o usuário pedir deve virar ADITAMENTO (novo Contract kind="addendum") — NÃO edite o original. Siga regra 20: consulte KB pra modelo, herde template+style do parent, use estrutura formal de aditamento. Se for apenas dúvida sem write, responda informativo normal.`
      : `\n\n📝 ESTADO DE ASSINATURA: contrato é RASCUNHO (não assinado). Alterações vão DIRETO no documento original via \`edit_contract_section\` ou \`propose_suggestion\` — NÃO crie aditamento. Aditamento só faz sentido depois da assinatura.`
    : "";

  return `${expert}${attach}MENSAGEM DO USUÁRIO:

${state.userMessage}

---
## DADOS DO CONTRATO
- Modalidade: ${ctx.templateModalidade ?? "?"}
- Template: ${ctx.templateName ?? "(importado)"}
- Cláusulas ativas: ${ctx.activeClauses.length}
- Google Docs: ${ctx.googleDocId ? "sim" : "não"}

## ${contentLabel}

${htmlSlice}${truncated ? "\n...(truncado)" : ""}

---
Aplique a alteração solicitada usando as tools apropriadas. Lembre-se das regras 11.1 (propose_suggestion default em GDocs) e 11.2 (edit_contract_section pra texto hardcoded vs update_contract_data pra {{variavel}}).${intentHint}${signingHint}`;
}
