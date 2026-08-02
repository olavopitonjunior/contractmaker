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

import { AGENT_TOOLS, DIRECT_WRITE_TOOLS } from "../tools";
import { expertContextFor } from "../expert-context";
import { resolveAgentProfile } from "../agents/resolve";
import { composeSystemPrompt } from "../agents/prompt-blocks";
import { agentDisabledOutput } from "../agents/disabled";
import { runSpecialist, type ToolUseGuard } from "../shared/specialist-runner";
import { applyPolicy } from "../sentinel/middleware";
import { pickSpecialistPrompt } from "./prompts-locacao";
import { wantsDirectEdit as routerWantsDirectEdit } from "../orchestrator/routing";
import { toolboxFor } from "../agents/toolboxes";
import type { OrchestratorState, SpecialistOutput } from "../orchestrator/state";

// Toolbox no mapa canônico (agents/toolboxes.ts) — a tela do /admin lê o
// MESMO registro, então o que ela mostra é o que roda aqui. ChatPlan do
// propose_plan é criado com a session do graph (sessionId +
// pendingAssistantMessageId injetados pelo runner).
const EDITOR_TOOL_NAMES = toolboxFor("editor");

const EDITOR_TOOLS = AGENT_TOOLS.filter((t) => EDITOR_TOOL_NAMES.has(t.name));

const WRITE_INTENTS = new Set(["edit_simple", "edit_multi"]);

export interface EditorToolPolicy {
  toolNames: string[];
  forceToolUse: boolean;
  forceToolName?: string;
  /** Modo Planejar ativo e sem escape — writes diretos indisponíveis. */
  planGate: boolean;
  /** Usuário pediu execução imediata ("aplique direto"/"sem revisão"). */
  wantsDirectEdit: boolean;
}

/**
 * Decide toolbox e tool_choice do Editor a partir de mode × intent × escape.
 * Função PURA (não toca DB nem LLM) justamente pra ser testável — a matriz de
 * comportamento é o contrato do modo Planejar.
 *
 * Regras, em ordem de precedência:
 *  1. FORCE_DIRECT_EDIT ("aplique direto") vence em QUALQUER modo: remove as
 *     tools de proposta e deixa o write acontecer no mesmo turn.
 *  2. mode="plan" sem escape: writes diretos saem do toolbox e um intent de
 *     escrita é forçado a `propose_plan` (tool_choice nomeado). Sem a tool
 *     disponível, não existe write direto possível — não depende do prompt.
 *  3. mode="fast": comportamento histórico intacto (força tool em edit_simple).
 */
export function resolveEditorToolPolicy(
  state: Pick<OrchestratorState, "mode" | "intent" | "userMessage">
): EditorToolPolicy {
  // Ignora trechos citados: cláusula colada com "sem revisão" no texto não é
  // pedido de edição direta (ver routing.ts::stripQuotedSpans).
  const wantsDirectEdit = routerWantsDirectEdit(state.userMessage);
  const isWriteIntent = WRITE_INTENTS.has(state.intent ?? "");

  // C4 — Quando o user disse "aplique direto"/"sem revisão", remover
  // propose_plan e propose_suggestion das tools disponíveis. Sem a opção
  // no toolbox, o LLM é forçado a executar a sequência query+insert/edit no
  // mesmo turn. Belt + suspenders com a regra 0.2 do EDITOR_SYSTEM_PROMPT.
  if (wantsDirectEdit) {
    return {
      toolNames: [...EDITOR_TOOL_NAMES].filter(
        (n) => n !== "propose_plan" && n !== "propose_suggestion"
      ),
      forceToolUse: state.intent === "edit_simple",
      planGate: false,
      wantsDirectEdit: true,
    };
  }

  const planGate = state.mode === "plan";
  if (planGate) {
    return {
      toolNames: [...EDITOR_TOOL_NAMES].filter((n) => !DIRECT_WRITE_TOOLS.has(n)),
      forceToolUse: isWriteIntent,
      forceToolName: isWriteIntent ? "propose_plan" : undefined,
      planGate: true,
      wantsDirectEdit: false,
    };
  }

  return {
    toolNames: [...EDITOR_TOOL_NAMES],
    forceToolUse: state.intent === "edit_simple",
    planGate: false,
    wantsDirectEdit: false,
  };
}

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

  const policy = resolveEditorToolPolicy(state);
  const allowed = new Set(policy.toolNames);
  const tools = EDITOR_TOOLS.filter((t) => allowed.has(t.name));


  // Perfil resolvido: org → plataforma → hardcoded (/admin/agents e
  // /settings/ai-agents). Instruções são APÊNDICE ao prompt-base por-domínio
  // (venda×locação); o modelo, esse sim, substitui.
  const profile = await resolveAgentProfile("editor", state.orgId);
  if (!profile.enabled) return agentDisabledOutput("editor");

  // Preâmbulo carregado AQUI, já escopado pro perfil deste agente — ver
  // `expertContextFor`. Antes vinha pronto do `loadContextNode`, sem escopo.
  const expertContext = await expertContextFor({
    agentKey: "editor",
    mode: state.mode,
    context: state.contractContext,
  });
  const userPrompt = buildEditorPrompt(state, policy, expertContext);

  return runSpecialist({
    agentName: "editor",
    model: profile.model,
    systemPrompt: composeSystemPrompt(
      pickSpecialistPrompt("editor", state.contractContext),
      profile
    ),
    tools,
    maxIterations: 3,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    profile,
    toolGuard: guard,
    captureSnapshots: true,
    forceToolUse: policy.forceToolUse,
    forceToolName: policy.forceToolName,
    sessionId: state.sessionId,
  });
}

function buildEditorPrompt(
  state: OrchestratorState,
  policy: EditorToolPolicy,
  expertContext: string
): string {
  const expert = expertContext ? `${expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";
  const ctx = state.contractContext!;
  const truncated = ctx.htmlContent.length > 8000;
  const htmlSlice = ctx.htmlContent.slice(0, 8000);
  const contentLabel = ctx.googleDocId
    ? "TEXTO ATUAL DO CONTRATO (Google Doc — sem markup HTML)"
    : "HTML ATUAL DO CONTRATO";

  // C4 — FORCE_DIRECT_EDIT vence intent=edit_multi. Se o user pediu "aplique
  // direto", mesmo que tenha vários verbos a intenção é commit imediato.
  const intentHint = policy.wantsDirectEdit
    ? `\n\n⚡ INTENT=FORCE_DIRECT_EDIT: o user EXIGIU execução direta ("aplique direto"/"sem revisão"/"faça já"). Você NÃO tem acesso a \`propose_plan\` nem a \`propose_suggestion\` neste turn — foram removidos do toolbox propositalmente. Execute a sequência completa AGORA: se precisar do \`knowledgeItemId\`, chame \`query_knowledge_base\` no MESMO turn e em seguida chame o write (\`insert_clause\`/\`remove_clause\`/\`edit_contract_section\`/\`update_contract_data\`). Múltiplos tool_use no mesmo turn são esperados. NÃO pare após o read — o write é obrigatório.`
    : // Modo Planejar: o turn é de PROPOSTA. Os writes diretos já saíram do
      // toolbox — o hint existe pra explicar o porquê, não pra fazer cumprir.
      policy.planGate && policy.forceToolName === "propose_plan"
      ? `\n\n🧭 MODO PLANEJAR: o usuário está no modo "Planejar" — nada é aplicado no documento sem aprovação dele. Você NÃO tem acesso a \`edit_contract_section\`, \`update_contract_data\`, \`insert_clause\`, \`remove_clause\`, \`apply_style_preset\` nem \`insert_image\` neste turn: foram removidos do toolbox propositalmente. Chame \`propose_plan\` com a lista completa de steps (reads + writes), mesmo que a alteração pedida seja UMA só — os steps de write nomeiam as tools como texto e são executados depois que o usuário aprovar no PlanCard. Para um ajuste pontual de redação você também pode usar \`propose_suggestion\`, que cria uma sugestão revisável.`
      : policy.planGate
        ? `\n\n🧭 MODO PLANEJAR: writes diretos não estão disponíveis neste turn. Se a resposta exigir alterar o documento, proponha via \`propose_plan\` ou \`propose_suggestion\`.`
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
      : policy.planGate
        ? `\n\n📝 ESTADO DE ASSINATURA: contrato é RASCUNHO (não assinado). As alterações incidem sobre o documento original — NÃO crie aditamento. Aditamento só faz sentido depois da assinatura. (Neste turn elas são PROPOSTAS, conforme o modo Planejar acima.)`
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
