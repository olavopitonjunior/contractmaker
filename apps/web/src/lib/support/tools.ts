/**
 * Tools do assistente de suporte.
 *
 * Diferente de runAssistantTool (dados de locação), estas retornam metadados além
 * do texto — a rota precisa da similaridade dos hits (guardrail de handoff) e do
 * id da pendência criada. Por isso runSupportTool devolve um objeto, não string.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { searchSupportKnowledge } from "./knowledge";
import { createOrDedupeHandoff } from "./handoff";
import type { SupportModuleTag } from "./constants";

export const SUPPORT_TOOL_NAMES = ["search_support_kb", "request_human_handoff"] as const;
export type SupportToolName = (typeof SUPPORT_TOOL_NAMES)[number];

export function isSupportTool(name: string): name is SupportToolName {
  return (SUPPORT_TOOL_NAMES as readonly string[]).includes(name);
}

export const SUPPORT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_support_kb",
    description:
      "Busca na base de conhecimento de suporte trechos sobre COMO USAR a ferramenta (telas, fluxos, funcionalidades). Use ANTES de responder qualquer dúvida de uso do produto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A pergunta ou tópico do usuário." },
      },
      required: ["query"],
    },
  },
  {
    name: "request_human_handoff",
    description:
      "Encaminha a dúvida ao suporte humano quando a base NÃO tem resposta confiável. NÃO invente — prefira encaminhar. Informe a pergunta original do usuário.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "A pergunta do usuário, como ele fez." },
        reason: {
          type: "string",
          description: "Por que não deu pra responder (ex.: não encontrado na base).",
        },
      },
      required: ["question"],
    },
  },
];

export interface SupportToolContext {
  orgId?: string | null;
  userId?: string | null;
  screenPath?: string | null;
  moduleTags: SupportModuleTag[];
  transcript?: unknown;
}

export interface SupportToolResult {
  /** JSON string devolvido ao modelo como tool_result. */
  content: string;
  kbTopSimilarity?: number | null;
  kbHitIds?: string[];
  handoffId?: string;
}

export async function runSupportTool(
  name: string,
  input: Record<string, unknown>,
  ctx: SupportToolContext
): Promise<SupportToolResult> {
  if (name === "search_support_kb") {
    const query = typeof input.query === "string" ? input.query : "";
    const res = await searchSupportKnowledge(query, { moduleTags: ctx.moduleTags });
    return {
      content: JSON.stringify({
        mode: res.mode,
        // No modo keyword (sem Voyage) NÃO há similaridade — omitimos o campo em
        // vez de mandar null, que o modelo interpreta como "match ruim" e
        // encaminha à toa. Estes resultados são contexto VÁLIDO; responda com eles.
        note:
          res.mode === "keyword_fallback" && res.results.length
            ? "Resultados por palavra-chave (sem score). São contexto válido — use-os para responder."
            : undefined,
        results: res.results.map((r) => ({
          title: r.title,
          content: r.content,
          source: r.source,
          ...(typeof r.similarity === "number" ? { similarity: r.similarity } : {}),
        })),
      }),
      kbTopSimilarity: res.topSimilarity,
      kbHitIds: res.results.map((r) => r.id),
    };
  }

  if (name === "request_human_handoff") {
    const question =
      typeof input.question === "string" && input.question.trim()
        ? input.question
        : "(sem texto)";
    const { id, deduped } = await createOrDedupeHandoff({
      question,
      orgId: ctx.orgId,
      userId: ctx.userId,
      screenPath: ctx.screenPath,
      transcript: ctx.transcript,
    });
    return {
      content: JSON.stringify({
        status: "encaminhado",
        deduped,
        message:
          "Dúvida encaminhada ao suporte humano. O usuário será avisado quando respondermos.",
      }),
      handoffId: id,
    };
  }

  return { content: JSON.stringify({ error: `Tool de suporte desconhecida: ${name}` }) };
}
