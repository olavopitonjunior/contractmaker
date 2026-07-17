/**
 * CuratorAgent — detecta padrões e PROPÕE mudanças na biblioteca/templates.
 * Modelo: Haiku 4.5 (proposta, não edita direto). Max 2 iterações.
 *
 * Tools:
 *   - find_similar_contracts (descoberta de padrões)
 *   - propose_new_clause (rate-limited: 5 pendentes/org)
 *   - propose_template_change (rate-limited: 1/dia/template)
 *
 * Cada propose_* passa por Sentinel — regra
 * `no_template_change_without_evidence` exige `evidence.length >= 1`.
 */

import { AGENT_TOOLS } from "../tools";
import { HAIKU_MODEL, resolveModel } from "../shared/anthropic-client";
import {
  getPlatformAgentDefaults,
  buildPlatformPromptOverrideBlock,
} from "./platform-defaults";
import { runSpecialist, type ToolUseGuard } from "../shared/specialist-runner";
import { applyPolicy } from "../sentinel/middleware";
import { pickSpecialistPrompt } from "./prompts-locacao";
import type { OrchestratorState, SpecialistOutput } from "../orchestrator/state";

const CURATOR_TOOL_NAMES = new Set([
  "find_similar_contracts",
  "propose_new_clause",
  "propose_template_change",
]);

const CURATOR_TOOLS = AGENT_TOOLS.filter((t) => CURATOR_TOOL_NAMES.has(t.name));

export async function runCurator(state: OrchestratorState): Promise<SpecialistOutput> {
  if (!state.contractContext) {
    throw new Error("runCurator: contractContext não foi carregado");
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

  const userPrompt = buildCuratorPrompt(state);

  const overrides = await getPlatformAgentDefaults();

  return runSpecialist({
    agentName: "curator",
    // Overrides de plataforma (/admin/agent-defaults) — null = hardcoded.
    model: resolveModel(overrides.curatorModel ?? undefined, HAIKU_MODEL),
    // Prompt override é APÊNDICE ao base por-domínio (venda×locação) — não
    // substitui, senão a variante de locação sumiria (singleton só tem o
    // baseline de venda). Modelo, esse sim, substitui.
    systemPrompt:
      pickSpecialistPrompt("curator", state.contractContext) +
      (overrides.curatorPrompt
        ? buildPlatformPromptOverrideBlock(overrides.curatorPrompt)
        : ""),
    tools: CURATOR_TOOLS,
    maxIterations: 2,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    toolGuard: guard,
    captureSnapshots: false,
    // Curator existe pra propor mudanças na biblioteca/templates. Sem
    // forceToolUse, Haiku frequentemente responde "analisei e não há
    // padrão pra propor" sem nem chamar `find_similar_contracts`. Como
    // Sentinel já bloqueia `propose_template_change` sem evidence (regra
    // `no_template_change_without_evidence`), forçar tool_use não cria
    // propostas vazias — só garante que o agente CONSULTE a memória
    // antes de decidir.
    forceToolUse: true,
  });
}

function buildCuratorPrompt(state: OrchestratorState): string {
  const expert = state.expertContext ? `${state.expertContext}\n\n---\n` : "";
  const ctx = state.contractContext!;

  return `${expert}MENSAGEM DO USUÁRIO:

${state.userMessage}

---
## CONTRATO ATUAL
- Modalidade: ${ctx.templateModalidade ?? "?"}
- Template: ${ctx.templateName ?? "(importado)"}
- Cláusulas ativas: ${ctx.activeClauses.length}

---
Use \`find_similar_contracts\` pra confirmar se há padrão recorrente. Se sim, proponha mudança via \`propose_new_clause\` ou \`propose_template_change\` com evidence (ids dos contractMemory que motivaram). Sentinel rejeita propostas sem evidência. Responda explicando o que foi detectado e o que foi proposto.`;
}
