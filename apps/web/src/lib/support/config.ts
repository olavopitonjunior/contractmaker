/**
 * Config do assistente de suporte (singleton de plataforma).
 *
 * Espelha o padrão de AgentConfig (editor de contrato), mas é único de plataforma
 * e editável pelo super-admin em /admin/support-ai. systemPrompt vazio no DB →
 * usa o SUPPORT_DEFAULT_SYSTEM_PROMPT abaixo.
 */

import { prisma } from "@/lib/db/prisma";

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
}

export async function getSupportConfig(): Promise<SupportConfig> {
  const row = await prisma.supportAgentConfig.findFirst();
  const prompt = row?.systemPrompt?.trim();
  return {
    model: row?.model || SUPPORT_DEFAULT_MODEL,
    temperature: row?.temperature ?? 0.3,
    maxTokens: row?.maxTokens ?? 1024,
    systemPrompt: prompt ? row!.systemPrompt : SUPPORT_DEFAULT_SYSTEM_PROMPT,
    handoffMinSimilarity: row?.handoffMinSimilarity ?? 0.55,
  };
}
