/**
 * Caminho OpenAI do OCR — o segundo provedor do pipeline.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * Até aqui o OCR falava só Gemini: `ocrModelFromEnv()` devolvia um nome e ele
 * ia direto para o SDK do Google. Medido contra 10 documentos reais em 25/08,
 * o `gpt-5.6-luna` leu melhor que qualquer candidato Gemini:
 *
 *   modelo                     acurácia   omissão
 *   gemini-2.5-flash (então)     79,0%     14,9%
 *   gemini-3.5-flash-lite 2et    83,8%      7,8%
 *   gpt-5.6-luna xhigh           91,0%      5,8%
 *
 * ── O que este módulo NÃO faz ────────────────────────────────────────────
 *
 * Não é uma camada de provider genérica. O chat, os especialistas e o passivo
 * seguem falando Anthropic direto, e a extração de contrato segue no Gemini.
 * Generalizar isso é trabalho de outra ordem, e este arquivo existe para
 * atender UM caso medido, não para antecipar os outros.
 *
 * ── Custo ────────────────────────────────────────────────────────────────
 *
 * `completion_tokens` da OpenAI JÁ INCLUI `reasoning_tokens` — verificado
 * contra a API (651 completion dos quais 512 de raciocínio). Ou seja, aqui não
 * se repete o bug que `geminiUsageToTokens` corrigiu, onde o raciocínio vinha
 * num campo separado e ficava de fora da conta.
 */

/** Modelos servidos por este caminho. Qualquer outro nome vai para o Gemini. */
const MODELOS_OPENAI = new Set(["gpt-5.6-luna", "gpt-5.6-luna-pro", "gpt-5.6-sol", "gpt-5.6-terra"]);

export function isModeloOpenAI(modelo: string): boolean {
  return MODELOS_OPENAI.has(modelo) || modelo.startsWith("gpt-");
}

/**
 * Esforço de raciocínio. O pedido "gpt-5.6-luna-xhigh" era ISTO: `xhigh` é
 * valor de parâmetro, não sufixo de nome de modelo.
 */
export function esforcoDeRaciocinio(env: NodeJS.ProcessEnv = process.env): string {
  return env.OCR_OPENAI_REASONING_EFFORT?.trim() || "high";
}

export interface RespostaOpenAI {
  text: string;
  promptTokens: number;
  /** Já inclui os tokens de raciocínio, como a OpenAI os fatura. */
  completionTokens: number;
  reasoningTokens: number;
}

export async function chamarOpenAIOcr(p: {
  modelo: string;
  prompt: string;
  base64: string;
  mimeType: string;
  schema?: Record<string, unknown> | null;
}): Promise<RespostaOpenAI> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY nao configurada");

  // PDF vai como `file`, que o modelo aceita nativamente — sem rasterizar, que
  // é o que o pipeline do Gemini também faz. Imagem vai como data URI.
  const parte =
    p.mimeType === "application/pdf"
      ? {
          type: "file",
          file: {
            filename: "documento.pdf",
            file_data: `data:application/pdf;base64,${p.base64}`,
          },
        }
      : {
          type: "image_url",
          image_url: { url: `data:${p.mimeType};base64,${p.base64}` },
        };

  const body: Record<string, unknown> = {
    model: p.modelo,
    messages: [
      { role: "user", content: [{ type: "text", text: p.prompt }, parte] },
    ],
    reasoning_effort: esforcoDeRaciocinio(),
  };
  if (p.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "extracao_ocr", strict: false, schema: p.schema },
    };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Mensagem no formato que `humanizeOcrError` e `shouldTryFallbackModel`
    // já sabem ler — inclui o status, que é o que as duas heurísticas casam.
    throw new Error(
      `OpenAI OCR got status: ${res.status}. ${(await res.text()).slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  return {
    text: json.choices?.[0]?.message?.content ?? "{}",
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** JSON Schema (draft) a partir da lista de campos da categoria. */
export function schemaJsonDeCampos(
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
