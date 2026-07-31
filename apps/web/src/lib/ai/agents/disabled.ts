import { AGENT_REGISTRY, type AgentKey } from "./registry";
import type { SpecialistOutput } from "../orchestrator/state";

/**
 * Resposta de um agente desligado no console (`AgentProfile.enabled = false`).
 *
 * Kill switch operacional: o turn termina sem chamar a API e sem gastar token,
 * mas DIZ que está desligado — falhar em silêncio faria o usuário achar que a
 * IA está quebrada, e faria o aggregator confabular por cima de um output
 * vazio.
 */
export function agentDisabledOutput(agentKey: AgentKey): SpecialistOutput {
  const label = AGENT_REGISTRY[agentKey].label;
  return {
    text: `⚠️ O agente "${label}" está desativado nas configurações de IA. Um administrador pode reativá-lo em Configurações → Agentes de IA.`,
    toolCalls: [],
  };
}
