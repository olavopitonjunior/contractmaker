/**
 * AnalystAgent — read-only specialist focado em validação técnica e
 * detecção de contradições. Modelo: Haiku 4.5. Max 2 iterações.
 *
 * Tools (subset de `AGENT_TOOLS`):
 *   - validate_contract
 *   - analyze_contradictions
 *   - extract_document_data
 *   - add_comment (severity error/warning/info)
 *
 * Não edita o contrato — isso é trabalho do Editor (F2).
 */

import { AGENT_TOOLS } from "../tools";
import { expertContextFor } from "../expert-context";
import { resolveAgentProfile } from "../agents/resolve";
import { composeSystemPrompt } from "../agents/prompt-blocks";
import { agentDisabledOutput } from "../agents/disabled";
import { runSpecialist } from "../shared/specialist-runner";
import { pickSpecialistPrompt } from "./prompts-locacao";
import type { OrchestratorState, SpecialistOutput } from "../orchestrator/state";

const ANALYST_TOOL_NAMES = new Set([
  "validate_contract",
  "analyze_contradictions",
  "extract_document_data",
  "add_comment",
  "cross_check_certidoes",
]);

const ANALYST_TOOLS = AGENT_TOOLS.filter((t) => ANALYST_TOOL_NAMES.has(t.name));

export async function runAnalyst(state: OrchestratorState): Promise<SpecialistOutput> {
  if (!state.contractContext) {
    throw new Error("runAnalyst: contractContext não foi carregado (chame loadContext node antes)");
  }

  const profile = await resolveAgentProfile("analyst", state.orgId);
  if (!profile.enabled) return agentDisabledOutput("analyst");

  // Preâmbulo carregado AQUI, já escopado pro perfil deste agente — ver
  // `expertContextFor`. Antes vinha pronto do `loadContextNode`, sem escopo.
  const expertContext = await expertContextFor({
    agentKey: "analyst",
    mode: state.mode,
    context: state.contractContext,
  });
  const userPrompt = buildAnalystPrompt(state, expertContext);

  // Perfil resolvido: org → plataforma → hardcoded (/admin/agents e
  // /settings/ai-agents). Instruções são APÊNDICE ao prompt-base por-domínio
  // (venda×locação); o modelo, esse sim, substitui.

  return runSpecialist({
    agentName: "analyst",
    model: profile.model,
    systemPrompt: composeSystemPrompt(
      pickSpecialistPrompt("analyst", state.contractContext),
      profile
    ),
    tools: ANALYST_TOOLS,
    maxIterations: 2,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    profile,
  });
}

function buildAnalystPrompt(state: OrchestratorState, expertContext: string): string {
  const expert = expertContext ? `${expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";

  return `${expert}${attach}MENSAGEM DO USUÁRIO (analise o contrato neste contexto e reporte findings):

${state.userMessage}

---
CONTRATO: contractId=${state.contractId}

Use \`validate_contract\` e \`analyze_contradictions\` se precisar de varredura sistemática. Use \`add_comment\` pra ancorar findings nos trechos exatos. Responda com markdown estruturado listando os findings em ordem de prioridade.`;
}
