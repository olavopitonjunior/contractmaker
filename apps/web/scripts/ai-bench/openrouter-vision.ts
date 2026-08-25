/**
 * Cliente do OpenRouter para o bench de VISÃO.
 *
 * ── Por que fica no bench e não em lib/ ──────────────────────────────────
 *
 * O repositório não fala OpenRouter em runtime — a única menção é o enum de
 * provider em `AIUsage`, para o Max (que roda em outro repo) reportar custo.
 * Plugar OpenRouter no pipeline de OCR de verdade é trabalho de camada de
 * provider, e não se justifica antes de existir um número dizendo que vale.
 *
 * Este módulo existe para PRODUZIR esse número. Se o candidato vencer, aí sim
 * a integração de runtime se paga.
 *
 * ── O que o `-xhigh` do pedido significa ─────────────────────────────────
 *
 * Não existe um modelo `gpt-5.6-luna-xhigh`. `xhigh` é valor de
 * `reasoning_effort`, um PARÂMETRO — o modelo é `openai/gpt-5.6-luna`.
 * Verificado contra a API em 25/08: o valor é aceito.
 */

export interface RespostaOpenRouter {
  texto: string;
  promptTokens: number;
  /** Já inclui os tokens de raciocínio, como o provedor os fatura. */
  completionTokens: number;
}

export interface OpcoesOpenRouter {
  modelo: string;
  prompt: string;
  base64: string;
  mimeType: string;
  /** `low` | `medium` | `high` | `xhigh`. Omitido, usa o padrão do modelo. */
  esforco?: string;
  /** JSON Schema da categoria. Omitido, a saída é livre. */
  schema?: Record<string, unknown> | null;
}

export async function chamarOpenRouter(
  apiKey: string,
  o: OpcoesOpenRouter
): Promise<RespostaOpenRouter> {
  // PDF vai como `file`, que este modelo aceita nativamente — sem rasterizar.
  // Imagem vai como `image_url` com data URI. São os dois caminhos que o OCR
  // de produção exercita.
  const parte =
    o.mimeType === "application/pdf"
      ? {
          type: "file",
          file: {
            filename: "documento.pdf",
            file_data: `data:application/pdf;base64,${o.base64}`,
          },
        }
      : {
          type: "image_url",
          image_url: { url: `data:${o.mimeType};base64,${o.base64}` },
        };

  const body: Record<string, unknown> = {
    model: o.modelo,
    messages: [
      { role: "user", content: [{ type: "text", text: o.prompt }, parte] },
    ],
    max_tokens: 4000,
  };
  if (o.esforco) body.reasoning = { effort: o.esforco };
  if (o.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "extracao", strict: false, schema: o.schema },
    };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  // O OpenRouter devolve 200 com `error` no corpo em algumas falhas — tratar
  // como sucesso deixaria a chamada contar como "resposta vazia" em vez de
  // falha, e a taxa de falha do candidato é resultado, não ruído.
  if (json.error) {
    throw new Error(`OpenRouter: ${json.error.message ?? "erro sem mensagem"}`);
  }

  return {
    texto: json.choices?.[0]?.message?.content ?? "",
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
  };
}

/** JSON Schema (draft) a partir da lista de campos da categoria. */
export function schemaJsonDaCategoria(
  campos: readonly string[]
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      tipo: { type: "string" },
      campos: {
        type: "object",
        properties: Object.fromEntries(
          campos.map((k) => [k, { type: ["string", "null"] }])
        ),
      },
      confidence: { type: "number" },
    },
    required: ["tipo", "campos", "confidence"],
  };
}
