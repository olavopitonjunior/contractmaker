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
  // O 11º agente que a lista escondia: é o agregador quem escreve o texto
  // final que o usuário lê no chat multi-agente. Sem ele aqui, "todos os
  // agentes" no console era uma lista de 10 num sistema de 11.
  "aggregator",
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
  supports: {
    enabled: boolean;
    model: boolean;
    instructions: boolean;
    /**
     * O agente consulta a base de conhecimento E carimba `agentKey` no
     * contexto? Só quem faz as duas coisas honra `ragScope`/`visibleToAgents`.
     *
     * `passive` e `insights` chamam o modelo SEM `tools` — não há base a
     * escopar, então oferecer o controle não seria "inerte", seria sem
     * sentido. `ocr` roda no Gemini e `max` é externo.
     */
    ragScope: boolean;
  };
}

const ALL: AgentDefinition["supports"] = {
  enabled: true,
  model: true,
  instructions: true,
  ragScope: true,
};

/** Consome LLM e aceita configuração, mas não consulta a base de conhecimento. */
const SEM_RAG: AgentDefinition["supports"] = { ...ALL, ragScope: false };

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
    // `clause_generate` é o botão "gerar com IA" de /clauses — mesma função do
    // curador (alimentar o acervo), só que disparada pela UI em vez do chat.
    operations: ["specialist_curator", "clause_generate"],
    supports: ALL,
  },
  aggregator: {
    key: "aggregator",
    label: "Agregador",
    description:
      "Sintetiza as respostas dos especialistas no texto final do chat. Roda dentro do orquestrador — ainda não lê este perfil.",
    defaultModel: SONNET_MODEL,
    tenantEditable: false,
    // Grava `operation: "chat"` — a MESMA que o agente legado. Por isso a
    // operação segue em AMBIGUOUS_OPERATIONS e os dois call-sites carimbam
    // `agentKey` explícito; listá-la aqui atribuiria o histórico inteiro do
    // legado ao agregador.
    operations: [],
    supports: { enabled: false, model: false, instructions: false, ragScope: false },
  },
  passive: {
    key: "passive",
    label: "Análise automática",
    description: "Revisa o contrato em segundo plano e comenta o que achar.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    operations: ["passive_open", "passive_edit"],
    // Instruções ainda não plugadas no prompt da análise passiva.
    supports: { enabled: true, model: true, instructions: false, ragScope: false },
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
    supports: SEM_RAG,
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
      // Ingestão DOCX→template: o pass de IA que mapeia trechos do Doc-modelo
      // pra {{placeholders}}. É leitura de documento como as demais — roda em
      // Anthropic, não Gemini, mas a atribuição aqui é de custo, não de motor.
      "template_placeholder_insertion",
    ],
    supports: { enabled: false, model: false, instructions: false, ragScope: false },
  },
  insights: {
    key: "insights",
    label: "Insights",
    description: "Resumos e alertas nas telas de gestão.",
    defaultModel: HAIKU_MODEL,
    tenantEditable: true,
    // DIMOB (copiloto fiscal) e o resumo de pesquisas são a mesma família:
    // IA one-shot resumindo/alertando numa tela de gestão.
    operations: [
      "insights",
      "dimob_review",
      "dimob_diagnose",
      "dimob_explain",
      "survey_summary",
    ],
    supports: SEM_RAG,
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
    operations: ["max_chat"],
    // O endpoint já existe (`/api/agents/profile`), mas o runtime do Max é de
    // outro repo (Sessão C) e ainda não o consome. Enquanto não consumir, isto
    // fica `false`: um interruptor que não desliga nada é pior que a ausência
    // do interruptor. Vira `true` quando a Sessão C ler o perfil de verdade.
    supports: { enabled: false, model: false, instructions: false, ragScope: false },
  },
};

export const AGENT_DEFINITIONS: AgentDefinition[] = AGENT_KEYS.map(
  (k) => AGENT_REGISTRY[k]
);

/**
 * Agentes que rodam FORA deste repo e por isso leem o perfil por API
 * (`/api/agents/profile`) e reportam custo de volta (`/api/agents/usage`).
 *
 * A API de agentes é limitada a esta lista de propósito. Um token com
 * `agents:rw` que pudesse reportar uso como `editor` moveria o gasto — e o teto
 * mensal — de um agente interno a partir de fora; e um `agents:r` genérico
 * entregaria a um cliente externo o prompt de plataforma dos especialistas, que
 * nem o dono do tenant enxerga na UI. Agente novo entra aqui explicitamente.
 */
export const EXTERNAL_AGENT_KEYS: AgentKey[] = AGENT_DEFINITIONS.filter(
  (d) => d.external
).map((d) => d.key);

export function isExternalAgentKey(v: string): v is AgentKey {
  return (EXTERNAL_AGENT_KEYS as readonly string[]).includes(v);
}

/**
 * `operation` gravada por MAIS DE UM agente — a derivação não se aplica.
 *
 * `chat` é o caso: o agente legado (`agent.ts`) e o agregador do orquestrador
 * (`graph.ts`) gravam a mesma operação. Derivar daria `chat_legacy` para os dois
 * e inventaria dado num painel de CUSTO, que é onde inventar dado é pior.
 * Quem grava `chat` informa `agentKey` explicitamente ou fica sem atribuição.
 */
export const AMBIGUOUS_OPERATIONS = new Set<string>(["chat"]);

/**
 * Operações que NÃO são trabalho de agente nenhum — encanamento da plataforma:
 * embeddings de ingestão e consulta, memória de contratos, classificadores de
 * intenção/policy/upload. Forçá-las num agente inventaria dado no painel de
 * custo; escondê-las deixaria 26% do gasto como "não atribuído" genérico.
 * O painel as exibe como grupo "Infraestrutura", rotulado e separado.
 *
 * (`doc_analysis` ficou de fora de propósito: não tem mais escritor no código —
 * só linhas históricas. Aparece como "não atribuído", que é o que ela é.)
 */
export const INFRA_OPERATIONS = new Set<string>([
  "embed_kb",
  "embed_memory",
  "embed_query",
  "summarize_memory",
  "intent_classify",
  "sentinel_classify",
  "knowledge_upload_classification",
]);

/**
 * `operation` do AIUsage → agente. Usado quando o call-site não informa o
 * agente, e pelo backfill do histórico na migration.
 */
export const OPERATION_TO_AGENT: Record<string, AgentKey> = Object.fromEntries(
  AGENT_DEFINITIONS.flatMap((d) =>
    d.operations
      .filter((op) => !AMBIGUOUS_OPERATIONS.has(op))
      .map((op) => [op, d.key])
  )
);
