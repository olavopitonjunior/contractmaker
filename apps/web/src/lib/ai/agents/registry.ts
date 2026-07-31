/**
 * Catálogo dos agentes de IA da plataforma — a lista canônica que faltava.
 *
 * Até aqui a única enumeração era `SpecialistName` (orchestrator/state.ts), que
 * cobre só os 4 especialistas do chat de contrato e ignora tudo que também
 * consome LLM e também custa: análise passiva, OCR, insights, suporte, o agente
 * legado e o Max (externo). Sem catálogo, "custo por agente" e "budget por
 * agente" não têm de onde sair.
 *
 * `defaultModel` é o hardcoded — último elo da cadeia de resolução, usado
 * quando nem a org nem a plataforma definiram modelo. Mantido em sincronia com
 * o que cada call-site usava antes do AgentProfile; mudar aqui muda o padrão de
 * produção.
 */

import { HAIKU_MODEL, SONNET_MODEL } from "../shared/models";
import type { AIOperation } from "../usage";

export const AGENT_KEYS = [
  "analyst",
  "legal",
  "editor",
  "curator",
  "passive",
  "support",
  "ocr",
  "insights",
  "chat_legacy",
  "max",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export function isAgentKey(v: string): v is AgentKey {
  return (AGENT_KEYS as readonly string[]).includes(v);
}

export interface AgentDefinition {
  key: AgentKey;
  /** Nome exibido no console (PT-BR). */
  label: string;
  /** Uma linha explicando o que ele faz — vai pra UI, não pro prompt. */
  description: string;
  /** Último elo da cadeia de resolução. */
  defaultModel: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /**
   * Se a org pode escrever instruções adicionais pra este agente em
   * /settings/ai-agents. `false` nos agentes de plataforma (suporte) e no
   * que roda fora do produto (max é configurado pela plataforma).
   */
  tenantEditable: boolean;
  /** Roda dentro deste repo? `max` é externo (LangGraph, Sessão C). */
  external?: boolean;
  /**
   * Operations do AIUsage atribuídas a este agente. Serve pra reconstruir
   * custo por agente em linhas históricas, anteriores à coluna `agentKey`.
   */
  operations: AIOperation[];
  /**
   * O que o runtime REALMENTE honra hoje deste perfil. A UI usa isto pra não
   * oferecer controle inerte: um interruptor "Ativo" que não desliga nada, ou
   * um campo de instruções que ninguém lê, é pior que a ausência do controle —
   * o operador acha que agiu.
   */
  supports: { enabled: boolean; model: boolean; instructions: boolean };
}

const ALL: AgentDefinition["supports"] = {
  enabled: true,
  model: true,
  instructions: true,
};

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition> = {
  analyst: {
    key: "analyst",
    label: "Analista",
    description: "Lê o contrato e responde sobre dados, valores e pendências.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["specialist_analyst"],
    supports: ALL,
  },
  legal: {
    key: "legal",
    label: "Jurídico",
    description: "Base legal, precedentes e revisão de cláusulas.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["specialist_legal"],
    supports: ALL,
  },
  editor: {
    key: "editor",
    label: "Editor",
    description: "Aplica (ou propõe) alterações no documento do contrato.",
    defaultModel: SONNET_MODEL,
    tenantEditable: true,
    operations: ["specialist_editor"],
    supports: ALL,
  },
  curator: {
    key: "curator",
    label: "Curador",
    description: "Propõe cláusulas e melhorias de modelo pro acervo.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["specialist_curator"],
    supports: ALL,
  },
  passive: {
    key: "passive",
    label: "Análise automática",
    description: "Revisa o contrato em segundo plano e comenta o que achar.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["passive_open", "passive_edit"],
    // Instruções ainda não plugadas no prompt da análise passiva.
    supports: { enabled: true, model: true, instructions: false },
  },
  support: {
    key: "support",
    label: "IA de Suporte",
    description: "Atende dúvidas sobre a plataforma no widget de ajuda.",
    defaultModel: HAIKU_MODEL,
    defaultTemperature: 0.3,
    defaultMaxTokens: 1024,
    // Base e persona são da plataforma — tenant não escreve instrução aqui.
    tenantEditable: false,
    operations: ["support_chat", "assistant_chat"],
    supports: ALL,
  },
  ocr: {
    key: "ocr",
    label: "Leitura de documentos",
    description:
      "Extrai dados de RG, CPF, matrícula e contratos enviados. Roda em Gemini 2.5 Flash — ainda não lê este perfil.",
    // Placeholder: o OCR não consome o perfil (o modelo vem do env do Gemini).
    defaultModel: HAIKU_MODEL,
    tenantEditable: false,
    operations: [
      "ocr_form",
      "ocr_tool",
      "extract_ccv_doc",
      "extract_locacao_doc",
      "voice_extract",
    ],
    supports: { enabled: false, model: false, instructions: false },
  },
  insights: {
    key: "insights",
    label: "Insights",
    description: "Resumos e alertas nas telas de gestão.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["insights"],
    supports: ALL,
  },
  chat_legacy: {
    key: "chat_legacy",
    label: "Chat (caminho legado)",
    description:
      "Agente single-turn usado só no rollback (ENABLE_MULTI_AGENT=false) e no resolver de comentários.",
    defaultModel: SONNET_MODEL,
    defaultTemperature: 0.3,
    defaultMaxTokens: 4096,
    tenantEditable: true,
    operations: ["chat"],
    supports: ALL,
  },
  max: {
    key: "max",
    label: "Max (WhatsApp)",
    description:
      "Agente externo em LangGraph — lê seu perfil por API e reporta o uso de volta.",
    defaultModel: SONNET_MODEL,
    tenantEditable: false,
    external: true,
    operations: [],
    // Passa a valer quando o endpoint do PR5 existir e o Max consumi-lo.
    supports: { enabled: false, model: false, instructions: false },
  },
};

export const AGENT_DEFINITIONS: AgentDefinition[] = AGENT_KEYS.map(
  (k) => AGENT_REGISTRY[k]
);

/** operation do AIUsage → agente, pra atribuir linhas históricas (PR4). */
export const OPERATION_TO_AGENT: Record<string, AgentKey> = Object.fromEntries(
  AGENT_DEFINITIONS.flatMap((d) => d.operations.map((op) => [op, d.key]))
);
