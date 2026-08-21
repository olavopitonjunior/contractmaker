/**
 * Toolbox de cada agente — a fonte única que faltava.
 *
 * Até aqui eram 4 `Set<string>` hardcoded, um dentro de cada
 * `specialists/*.ts`: não existia lugar no sistema que respondesse "quais
 * tools o Jurídico tem?" sem abrir os quatro arquivos. Agora os especialistas
 * E a tela do /admin leem O MESMO mapa — a tela nunca diverge do runtime
 * porque não existe segunda cópia pra divergir.
 *
 * Isto NÃO é configuração: ligar/desligar tool por agente via banco é outro
 * nível de risco e fica explicitamente fora (não-objetivo do plano). É a
 * declaração canônica do que o código faz.
 *
 * `chat_legacy` usa AGENT_TOOLS completo (com o gate de modo Planejar podando
 * writes em runtime — ver resolveEditorToolPolicy/agent.ts). Os demais agentes
 * não têm toolbox: passivo/insights/support chamam o modelo sem `tools`, ocr
 * roda no Gemini, aggregator só sintetiza, max é externo (o catálogo dele é o
 * MCP, exposto à parte).
 */

import type { AgentKey } from "./registry";

export const AGENT_TOOLBOXES: Partial<Record<AgentKey, readonly string[]>> = {
  analyst: [
    "validate_contract",
    "analyze_contradictions",
    "extract_document_data",
    "add_comment",
    "cross_check_certidoes",
  ],
  legal: [
    "query_templates",
    "explain_clause",
    "query_knowledge_base",
    "find_similar_contracts",
  ],
  editor: [
    "edit_contract_section",
    "update_contract_data",
    "propose_suggestion",
    "insert_clause",
    "remove_clause",
    "insert_image",
    "add_comment",
    // F4: Editor consulta crosscheck antes de propor aditamento — passa por
    // Sentinel (read-only, sem write contra contrato).
    "cross_check_certidoes",
    // F5: propose_plan permite Editor responder a intents edit_multi sem
    // cair no streamContractAgent legacy.
    "propose_plan",
  ],
  curator: [
    "find_similar_contracts",
    "propose_new_clause",
    "propose_template_change",
  ],
};

export function toolboxFor(agentKey: AgentKey): Set<string> {
  return new Set(AGENT_TOOLBOXES[agentKey] ?? []);
}
