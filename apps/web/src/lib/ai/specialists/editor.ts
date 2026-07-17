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
import { SONNET_MODEL, resolveModel } from "../shared/anthropic-client";
import {
  getPlatformAgentDefaults,
  buildPlatformPromptOverrideBlock,
} from "./platform-defaults";
import { runSpecialist, type ToolUseGuard } from "../shared/specialist-runner";
import { applyPolicy } from "../sentinel/middleware";
import { pickSpecialistPrompt } from "./prompts-locacao";
import { ROUTER_REGEXES } from "../orchestrator/routing";
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

  // C4 — Quando o user disse "aplique direto"/"sem revisão", remover
  // propose_plan e propose_suggestion das tools disponíveis. Sem a opção
  // no toolbox, o LLM é forçado a executar a sequência query+insert/edit no
  // mesmo turn. Belt + suspenders com a regra 0.2 do EDITOR_SYSTEM_PROMPT.
  const wantsDirectEdit = ROUTER_REGEXES.FORCE_DIRECT_EDIT.test(state.userMessage);
  const tools = wantsDirectEdit
    ? EDITOR_TOOLS.filter(
        (t) => t.name !== "propose_plan" && t.name !== "propose_suggestion"
      )
    : EDITOR_TOOLS;

  const userPrompt = buildEditorPrompt(state, wantsDirectEdit);

  const overrides = await getPlatformAgentDefaults();

  return runSpecialist({
    agentName: "editor",
    // Overrides de plataforma (/admin/agent-defaults) — null = hardcoded.
    model: resolveModel(overrides.editorModel ?? undefined, SONNET_MODEL),
    // Prompt override é APÊNDICE ao base por-domínio (venda×locação) — não
    // substitui, senão a variante de locação sumiria (singleton só tem o
    // baseline de venda). Modelo, esse sim, substitui.
    systemPrompt:
      pickSpecialistPrompt("editor", state.contractContext) +
      (overrides.editorPrompt
        ? buildPlatformPromptOverrideBlock(overrides.editorPrompt)
        : ""),
    tools,
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

function buildEditorPrompt(state: OrchestratorState, wantsDirectEdit = false): string {
  const expert = state.expertContext ? `${state.expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";
  const ctx = state.contractContext!;
  const truncated = ctx.htmlContent.length > 8000;
  const htmlSlice = ctx.htmlContent.slice(0, 8000);
  const contentLabel = ctx.googleDocId
    ? "TEXTO ATUAL DO CONTRATO (Google Doc — sem markup HTML)"
    : "HTML ATUAL DO CONTRATO";

  // C4 — FORCE_DIRECT_EDIT vence intent=edit_multi. Se o user pediu "aplique
  // direto", mesmo que tenha vários verbos a intenção é commit imediato.
  const intentHint = wantsDirectEdit
    ? `\n\n⚡ INTENT=FORCE_DIRECT_EDIT: o user EXIGIU execução direta ("aplique direto"/"sem revisão"/"faça já"). Você NÃO tem acesso a \`propose_plan\` nem a \`propose_suggestion\` neste turn — foram removidos do toolbox propositalmente. Execute a sequência completa AGORA: se precisar do \`knowledgeItemId\`, chame \`query_knowledge_base\` no MESMO turn e em seguida chame o write (\`insert_clause\`/\`remove_clause\`/\`edit_contract_section\`/\`update_contract_data\`). Múltiplos tool_use no mesmo turn são esperados. NÃO pare após o read — o write é obrigatório.`
    : state.intent === "edit_multi"
      ? `\n\n⚠️ INTENT=edit_multi: a mensagem do usuário envolve MÚLTIPLAS edições encadeadas. Você DEVE chamar \`propose_plan\` primeiro com a lista completa de steps (reads + writes), ANTES de qualquer write direto. O sistema vai persistir ChatPlan pendente e o usuário aprova via PlanCard na UI. Writes diretos sem propose_plan em edit_multi são bug.`
      : "";

  // F4 iteração 2026-05-17 — informa o Editor sobre o estado de assinatura
  // pra decidir entre edit-no-draft e create-aditamento. signingState é
  // populado pelo loadContextNode no graph antes da invocação.
  const signingState = (state as unknown as { signingState?: { hasSignedContract: boolean; originalContractId: string | null } }).signingState;
  const signingHint = signingState
    ? signingState.hasSignedContract
      ? `\n\n🔒 ESTADO DE ASSINATURA: contrato ORIGINAL JÁ ASSINADO (envelope closed, original=${signingState.originalContractId}). Qualquer alteração que o usuário pedir deve virar ADITAMENTO (novo Contract kind="addendum") — NÃO edite o original. Consulte a KB pra modelo de aditamento, herde template+style do contrato pai e use estrutura formal de aditamento. Se for apenas dúvida sem write, responda informativo normal.`
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
Aplique a alteração solicitada usando as tools apropriadas. Lembre-se: em GDocs, \`propose_suggestion\` é o default; use \`edit_contract_section\` pra texto hardcoded e \`update_contract_data\` pra {{variavel}}.${intentHint}${signingHint}`;
}
