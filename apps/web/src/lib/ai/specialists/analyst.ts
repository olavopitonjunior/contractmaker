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
import { HAIKU_MODEL, resolveModel } from "../shared/anthropic-client";
import {
  getPlatformAgentDefaults,
  buildPlatformPromptOverrideBlock,
} from "./platform-defaults";
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

  const userPrompt = buildAnalystPrompt(state);

  const overrides = await getPlatformAgentDefaults();

  return runSpecialist({
    agentName: "analyst",
    // Overrides de plataforma (/admin/agent-defaults) — null = hardcoded.
    model: resolveModel(overrides.analystModel ?? undefined, HAIKU_MODEL),
    // Prompt override é APÊNDICE ao base por-domínio (venda×locação) — não
    // substitui, senão a variante de locação sumiria (singleton só tem o
    // baseline de venda). Modelo, esse sim, substitui.
    systemPrompt:
      pickSpecialistPrompt("analyst", state.contractContext) +
      (overrides.analystPrompt
        ? buildPlatformPromptOverrideBlock(overrides.analystPrompt)
        : ""),
    tools: ANALYST_TOOLS,
    maxIterations: 2,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
  });
}

function buildAnalystPrompt(state: OrchestratorState): string {
  const expert = state.expertContext ? `${state.expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";

  return `${expert}${attach}MENSAGEM DO USUÁRIO (analise o contrato neste contexto e reporte findings):

${state.userMessage}

---
CONTRATO: contractId=${state.contractId}

Use \`validate_contract\` e \`analyze_contradictions\` se precisar de varredura sistemática. Use \`add_comment\` pra ancorar findings nos trechos exatos. Responda com markdown estruturado listando os findings em ordem de prioridade.`;
}
