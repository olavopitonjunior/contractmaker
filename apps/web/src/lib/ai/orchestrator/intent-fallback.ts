/**
 * FU3 — Fallback de classificação de intent via Haiku para casos AMBÍGUOS.
 *
 * A heurística pura (`classifyIntent`) cobre a maioria. Quando ela cai em
 * `informational` mas a mensagem NÃO é uma pergunta clara (não termina em "?"
 * nem começa com interrogativo), pode ser um pedido de edição disfarçado sem
 * verbo conhecido. Só nesses casos chamamos um Haiku barato (max 16 tokens)
 * pra desambiguar. Falha → cai de volta na heurística (best-effort).
 *
 * Mantém `routing.ts` puro (testável sem mockar Anthropic) — a chamada LLM
 * vive aqui e é usada só pelo routerNode do grafo.
 */
import { classifyIntent, ROUTER_REGEXES, type Intent } from "./routing";
import { getAnthropicClient, HAIKU_MODEL } from "../shared/anthropic-client";
import { recordAIUsage } from "../usage";

const VALID_INTENTS: Intent[] = [
  "edit_multi",
  "edit_simple",
  "review",
  "propose",
  "informational",
];

const CLASSIFIER_SYSTEM = `Você classifica a mensagem de um usuário sobre um contrato imobiliário em UMA categoria. Responda SOMENTE com a palavra-chave, sem explicação:
- edit_simple — pede UMA alteração concreta no contrato (preencher/corrigir/ajustar um campo, trocar um valor).
- edit_multi — pede VÁRIAS alterações encadeadas (ex.: "revise tudo", "troque todas").
- review — pede análise/validação SEM alterar.
- propose — pede sugestão/proposta pra biblioteca/template.
- informational — pergunta ou consulta sobre o estado atual.`;

export async function resolveIntent(
  message: string,
  ctx?: { orgId?: string; userId?: string; contractId?: string }
): Promise<Intent> {
  const heuristic = classifyIntent(message);
  const msg = message.trim();
  const isQuestion = msg.endsWith("?") || ROUTER_REGEXES.QUESTION.test(msg);

  // Só desambigua quando a heurística "desistiu" (informational) e NÃO é pergunta.
  if (heuristic !== "informational" || isQuestion || msg.length === 0) {
    return heuristic;
  }

  try {
    const anthropic = getAnthropicClient();
    const t0 = Date.now();
    const resp = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 16,
      temperature: 0,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: message.slice(0, 600) }],
    });
    recordAIUsage({
      orgId: ctx?.orgId ?? "",
      userId: ctx?.userId,
      contractId: ctx?.contractId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation: "intent_classify" as never,
      promptTokens: resp.usage?.input_tokens ?? 0,
      completionTokens: resp.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
    const block = resp.content.find((b) => b.type === "text");
    const word = block && block.type === "text" ? block.text.trim().toLowerCase() : "";
    // edit_multi antes de edit_simple no VALID_INTENTS pra "includes" não casar errado.
    const match = VALID_INTENTS.find((v) => word.includes(v));
    return match ?? heuristic;
  } catch (err) {
    console.error("[resolveIntent] fallback Haiku falhou, usando heurística:", err);
    return heuristic;
  }
}
