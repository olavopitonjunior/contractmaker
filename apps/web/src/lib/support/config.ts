/**
 * Config do assistente de suporte.
 *
 * Desde o AgentProfile isto é o perfil de plataforma do agente `support`
 * (orgId = null), editável pelo super_admin em /admin/agents. Não há override
 * por tenant: base e persona do suporte são da plataforma (`tenantEditable:
 * false` no catálogo). `instructions` vazio → SUPPORT_DEFAULT_SYSTEM_PROMPT.
 */

import { resolveAgentProfile } from "@/lib/ai/agents/resolve";

export const SUPPORT_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Prompt-base do assistente. A rota injeta, a cada turno, a descrição da TELA
 * ATUAL (route-map) e os MÓDULOS ATIVOS do tenant — este texto assume que esse
 * contexto virá anexado.
 */
export const SUPPORT_DEFAULT_SYSTEM_PROMPT = `Você é o assistente de suporte do imobpro — plataforma de gestão de vendas e locação imobiliária. Sua função é ajudar o USUÁRIO a USAR a ferramenta: explicar telas, fluxos e funcionalidades, e indicar onde clicar para realizar cada tarefa.

Como responder:
- SEMPRE em PT-BR, direto e acionável. Quando for "como faço X", dê um passo a passo curto.
- Use a tool \`search_support_kb\` ANTES de responder qualquer dúvida sobre como usar o produto. Baseie a resposta nos trechos retornados e cite a tela/caminho de menu (ex.: "Pipeline → Novo negócio").
- NUNCA invente comportamento do produto. Se a base não trouxer um resultado confiável, chame \`request_human_handoff\` com a pergunta do usuário e avise, em uma frase, que encaminhou a dúvida ao suporte humano. Não chute.
- Considere a TELA ATUAL do usuário e os MÓDULOS ATIVOS do tenant (informados no contexto). Não explique recursos de um módulo que este tenant não tem habilitado.
- Seja conciso: sem saudações longas nem repetição da pergunta.`;

export interface SupportConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  handoffMinSimilarity: number;
  /** Kill switch do console (/admin/agents). */
  enabled: boolean;
}

export async function getSupportConfig(): Promise<SupportConfig> {
  const profile = await resolveAgentProfile("support", null);
  // handoffMinSimilarity é específico do suporte e não merece coluna própria —
  // vive no `config` do perfil (migrado do SupportAgentConfig).
  const minSim = Number(profile.config?.handoffMinSimilarity);
  return {
    model: profile.model || SUPPORT_DEFAULT_MODEL,
    temperature: profile.temperature ?? 0.3,
    maxTokens: profile.maxTokens ?? 1024,
    // A instrução do suporte SUBSTITUI o prompt-base (é a persona inteira, não
    // um apêndice) — comportamento herdado do SupportAgentConfig.
    systemPrompt: profile.platformInstructions || SUPPORT_DEFAULT_SYSTEM_PROMPT,
    handoffMinSimilarity: Number.isFinite(minSim) ? minSim : 0.55,
    enabled: profile.enabled,
  };
}
