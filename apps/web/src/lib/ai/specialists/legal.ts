/**
 * LegalAgent — read-only specialist focado em consulta legal, biblioteca
 * de cláusulas e padrões da organização. Modelo: Haiku 4.5. Max 2 iterações.
 *
 * Tools (subset de `AGENT_TOOLS`):
 *   - query_templates
 *   - explain_clause
 *   - query_knowledge_base (cobre legislação + biblioteca de cláusulas via category="clause")
 *   - find_similar_contracts
 *
 * É o especialista invocado em perguntas informativas (regra 10.1) —
 * "quais cláusulas tem este contrato?", "qual o artigo aplicável?", etc.
 */

import { AGENT_TOOLS } from "../tools";
import { expertContextFor } from "../expert-context";
import { resolveAgentProfile } from "../agents/resolve";
import { composeSystemPrompt } from "../agents/prompt-blocks";
import { agentDisabledOutput } from "../agents/disabled";
import { runSpecialist } from "../shared/specialist-runner";
import { pickSpecialistPrompt } from "./prompts-locacao";
import { toolboxFor } from "../agents/toolboxes";
import type { OrchestratorState, SpecialistOutput } from "../orchestrator/state";

// Toolbox no mapa canônico (agents/toolboxes.ts) — a tela do /admin lê o
// MESMO registro, então o que ela mostra é o que roda aqui.
const LEGAL_TOOL_NAMES = toolboxFor("legal");

const LEGAL_TOOLS = AGENT_TOOLS.filter((t) => LEGAL_TOOL_NAMES.has(t.name));

/**
 * Verbos de consulta — quando o usuário pede "busque/encontre/liste/mostre",
 * forçamos tool_choice=any pra que Haiku chame `query_knowledge_base` em vez
 * de inventar a resposta a partir do expert-context pré-carregado.
 *
 * Sem isso o Haiku 4.5 frequentemente cita IDs que já estão no contexto sem
 * fazer tool_call real — quebra a auditoria (ChatMessage.events fica sem
 * tool_use) e impede o user de ver o chip da consulta na UI.
 */
const QUERY_VERBS_REGEX =
  /\b(busque|encontre|liste|mostre|consulte|procure|ache|me\s+mostre)\b/i;

export async function runLegal(state: OrchestratorState): Promise<SpecialistOutput> {
  if (!state.contractContext) {
    throw new Error("runLegal: contractContext não foi carregado (chame loadContext node antes)");
  }

  const profile = await resolveAgentProfile("legal", state.orgId);
  if (!profile.enabled) return agentDisabledOutput("legal");

  // Preâmbulo carregado AQUI, já escopado pro perfil deste agente — ver
  // `expertContextFor`. Antes vinha pronto do `loadContextNode`, sem escopo.
  const expertContext = await expertContextFor({
    agentKey: "legal",
    mode: state.mode,
    context: state.contractContext,
  });
  const userPrompt = buildLegalPrompt(state, expertContext);

  // Perfil resolvido: org → plataforma → hardcoded (/admin/agents e
  // /settings/ai-agents). Instruções são APÊNDICE ao prompt-base por-domínio
  // (venda×locação); o modelo, esse sim, substitui.

  return runSpecialist({
    agentName: "legal",
    model: profile.model,
    systemPrompt: composeSystemPrompt(
      pickSpecialistPrompt("legal", state.contractContext),
      profile
    ),
    tools: LEGAL_TOOLS,
    maxIterations: 2,
    userPrompt,
    context: state.contractContext,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    profile,
    forceToolUse: QUERY_VERBS_REGEX.test(state.userMessage),
  });
}

function buildLegalPrompt(state: OrchestratorState, expertContext: string): string {
  const expert = expertContext ? `${expertContext}\n\n---\n` : "";
  const attach = state.attachmentBlock ? `${state.attachmentBlock}\n\n---\n` : "";

  const dataJsonMd = state.contractContext
    ? buildDataJsonSummary(state.contractContext.dataJson)
    : "";

  const activeClauses = state.contractContext?.activeClauses ?? [];
  const clausesMd = activeClauses.length
    ? activeClauses.map((c, i) => `${i + 1}. **${c.title}** (${c.category})`).join("\n")
    : "(nenhuma cláusula ativa)";

  return `${expert}${attach}MENSAGEM DO USUÁRIO:

${state.userMessage}

---
## DADOS DO CONTRATO (resumo)
${dataJsonMd}

## CLÁUSULAS ATIVAS
${clausesMd}

---
Responda em markdown estruturado. Cite legislação aplicável e padrões da organização quando relevante.`;
}

function buildDataJsonSummary(data: Record<string, unknown>): string {
  const v = (data.vendedores as Array<Record<string, unknown>> | undefined)?.length ?? 0;
  const c = (data.compradores as Array<Record<string, unknown>> | undefined)?.length ?? 0;
  const i = (data.imoveis as Array<Record<string, unknown>> | undefined)?.length ?? 0;
  const modalidade = data.modalidade || "?";
  return `- Modalidade: ${modalidade}\n- Vendedores: ${v} · Compradores: ${c} · Imóveis: ${i}`;
}
