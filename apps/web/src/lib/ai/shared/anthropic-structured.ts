/**
 * Cliente Anthropic para saídas ESTRUTURADAS, sem sampling params.
 *
 * ## Por que um caminho próprio, e não `getAnthropicClient().messages.create`
 *
 * Três incompatibilidades, todas com o mesmo desfecho (HTTP 400) e nenhuma
 * detectável em typecheck:
 *
 * 1. **Sampling params.** Todo call-site do cliente antigo manda `temperature`
 *    (o AgentConfig a expõe ao operador). `claude-opus-4-8`, `claude-opus-5` e
 *    o resto da família 4.7+ REJEITAM `temperature`/`top_p`/`top_k`. É por isso que
 *    `lib/ai/shared/models.ts` estava capado no 4.6 — e é isto que este módulo
 *    destrava: aqui não existe parâmetro de amostragem para vazar.
 * 2. **`budget_tokens`.** A profundidade de raciocínio nesses modelos é
 *    `output_config.effort`; `thinking.budget_tokens` responde 400.
 * 3. **Prefill.** O truque clássico de "abrir com `{`" para forçar JSON foi
 *    REMOVIDO — mensagem final do assistente também responde 400. O substituto
 *    é `output_config.format` (structured outputs), que é o que usamos.
 *
 * ## O corpo NÃO é o mesmo para todo modelo
 *
 * As três incompatibilidades acima valem em qualquer modelo que usamos. Os
 * parâmetros de RACIOCÍNIO não: `thinking` e `output_config.effort` existem na
 * família 4.6+ e respondem 400 no Haiku 4.5, que é a geração anterior. Foi o
 * terceiro 400 deste run ("adaptive thinking is not supported on this model").
 *
 * Por isso o corpo é montado a partir de uma TABELA DE CAPACIDADES
 * (`lib/ai/shared/model-capabilities.ts`), em {@link buildStructuredRequest}, e
 * não escrito à mão como se todo modelo fosse igual. `lib/ai/shared/request-lint.ts`
 * é a guarda local: reprova a combinação incompatível sem chamar a API.
 *
 * ## Por que `client.post` e não `client.messages.create`
 *
 * O `@anthropic-ai/sdk` do repo é o 0.30: os tipos dele não conhecem
 * `thinking`, `output_config` nem os campos de cache em `usage`. Passar o corpo
 * por `messages.create` exigiria um `as never` que apagaria a tipagem inteira
 * do request. `client.post` mantém o SDK no que ele é bom (auth, base URL,
 * retry, erros tipados) e nos deixa declarar o contrato do corpo e da resposta
 * aqui, num lugar só, revisável.
 *
 * ## Cache de prompt
 *
 * O `system` é uma LISTA de blocos e o chamador marca o breakpoint com
 * `cache: true` no último bloco ESTÁVEL (playbook + taxonomia). Dados voláteis
 * — o documento, o digest do lote — entram depois do breakpoint, senão cada
 * item do lote invalidaria o prefixo e o cache não pouparia nada.
 *
 * ## Streaming
 *
 * Opcional, por chamada (`stream: true`). A classificação é curta e vai sem;
 * o planner pede `max_tokens: 16.000` e vai COM — saída longa sem streaming é o
 * caso clássico de a requisição estourar o timeout antes da primeira resposta,
 * e foi o que matou a chamada do planner em staging (504 na Vercel).
 *
 * O acúmulo dos eventos é do SDK ({@link MessageStream}), não nosso: `usage`
 * chega partido entre `message_start` e `message_delta`, e remontar isso à mão
 * seria reescrever código que já existe e já é testado. O caminho passa por
 * `toReadableStream()` porque `client.messages.stream()` exigiria tipar o corpo
 * como `MessageCreateParams` — que, no 0.30, não conhece `thinking` nem
 * `output_config`, exatamente o motivo de usarmos `client.post`.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/streaming";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { getAnthropicClient } from "./anthropic-client";
import {
  capabilitiesFor,
  isKnownModel,
  supportsEffort,
} from "@/lib/ai/shared/model-capabilities";

/** Profundidade de raciocínio — `output_config.effort` da API atual. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** Bloco do system prompt. `cache: true` fecha o prefixo cacheável. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export interface StructuredCallInput {
  model: string;
  system: SystemBlock[];
  /** Conteúdo do turno do usuário — os dados voláteis da chamada. */
  userContent: string;
  /** JSON Schema da resposta. Objeto fechado (`additionalProperties: false`). */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: EffortLevel;
  /**
   * Receber a resposta em streaming. Ligue para todo `maxTokens` grande: o
   * corpo é o mesmo e a saída também, mas a conexão não fica muda enquanto o
   * modelo pensa — que é o que faz uma chamada longa morrer no timeout.
   */
  stream?: boolean;
}

export interface StructuredUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredCallResult<T> {
  data: T;
  model: string;
  usage: StructuredUsage;
  latencyMs: number;
}

/**
 * Corpo enviado a `POST /v1/messages`. Note a AUSÊNCIA de sampling params.
 *
 * `thinking` e `output_config.effort` são OPCIONAIS aqui porque nem toda
 * geração de modelo os aceita — ver {@link buildStructuredRequest}.
 */
export interface StructuredRequestBody {
  model: string;
  max_tokens: number;
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  messages: Array<{ role: "user"; content: string }>;
  /** Presente só quando a chamada é em streaming — a API o exige no CORPO. */
  stream?: true;
  thinking?: { type: "adaptive" };
  output_config: {
    effort?: EffortLevel;
    format: { type: "json_schema"; schema: Record<string, unknown> };
  };
}

/** Recorte da resposta que consumimos — os tipos do SDK 0.30 não a descrevem. */
interface StructuredResponseBody {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  /** Presente quando a API já entrega o JSON validado contra o schema. */
  parsed_output?: unknown;
  /** `"max_tokens"` quando a geração foi CORTADA por bater no teto de saída. */
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Falha ao obter JSON utilizável — separada para o chamador poder reagir. */
export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

function toSystemBlocks(
  blocks: readonly SystemBlock[]
): StructuredRequestBody["system"] {
  return blocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

/**
 * Geração cortada no teto de saída. Subclasse porque quem só quer saber "não
 * consegui JSON" continua pegando pelo tipo base, e quem sabe reagir ao tamanho
 * do lote (o planner) distingue.
 */
export class StructuredOutputTruncatedError extends StructuredOutputError {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputTruncatedError";
  }
}

/**
 * Extrai o JSON da resposta. `parsed_output` é o caminho feliz; o fallback é o
 * primeiro bloco de texto, porque structured outputs também devolve o JSON ali
 * e uma resposta sem `parsed_output` (modelo mais antigo, campo renomeado) não
 * pode derrubar o run inteiro.
 */
function extractJson(body: StructuredResponseBody): unknown {
  // ANTES de tentar parsear. Resposta cortada no teto de saída é JSON inválido
  // por consequência, não por causa: dizer "não é JSON válido" manda quem lê
  // procurar defeito de formato quando o que falta é espaço. Foi o que
  // aconteceu no lote de 20 documentos da Ativa, cujo plano não coube nos
  // 16.000 tokens que bastavam para 11.
  if (body.stop_reason === "max_tokens") {
    throw new StructuredOutputTruncatedError(
      "A resposta do modelo foi cortada no limite de tokens de saída — o " +
        "resultado não coube. Reduza o lote ou aumente `maxTokens`."
    );
  }
  if (body.parsed_output != null) return body.parsed_output;

  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new StructuredOutputError("A resposta do modelo veio sem conteúdo.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new StructuredOutputError(
      `A resposta do modelo não é JSON válido: ${text.slice(0, 200)}`
    );
  }
}

/**
 * Monta o corpo da requisição a partir das CAPACIDADES do modelo.
 *
 * Os parâmetros de raciocínio não são universais e o mesmo valor é obrigatório
 * num modelo e proibido em outro:
 *
 * - família 4.6+ (`claude-opus-4-8`, `claude-opus-5`, `claude-sonnet-5`…):
 *   `thinking: {type:"adaptive"}` EXPLÍCITO — no Opus 4.8, que é o modelo do
 *   planner, omitir significa rodar sem raciocínio nenhum — mais
 *   `output_config.effort` para a profundidade;
 * - `claude-haiku-4-5`: sem `thinking` e sem `effort`. Não traduzimos para o
 *   `budget_tokens` antigo de propósito: classificação estruturada barata não
 *   precisa de raciocínio estendido, e é um parâmetro a menos para dar errado;
 * - desconhecido: conservador, sem os dois. Ver `CONSERVATIVE_FALLBACK`.
 *
 * O que é invariante em TODOS: zero sampling params, zero prefill,
 * `output_config.format` para structured output.
 *
 * Exportado para o teste conseguir inspecionar o corpo sem rede — é sobre ele
 * que `lintStructuredRequest` roda em `__tests__/request-lint.test.ts`.
 */
export function buildStructuredRequest(
  input: StructuredCallInput
): StructuredRequestBody {
  const caps = capabilitiesFor(input.model);
  if (!isKnownModel(input.model)) {
    // Não é fatal — a chamada roda sem os parâmetros de raciocínio. Mas fica
    // dito, porque um modelo fora da tabela quer dizer que alguém trocou uma
    // constante sem passar pelas capacidades.
    console.warn(
      `[anthropic] modelo "${input.model}" não está na tabela de capacidades; ` +
        "seguindo sem `thinking` e sem `effort` (ver model-capabilities.ts)."
    );
  }

  return {
    model: input.model,
    max_tokens: input.maxTokens,
    system: toSystemBlocks(input.system),
    messages: [{ role: "user", content: input.userContent }],
    ...(input.stream ? { stream: true as const } : {}),
    ...(caps.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: {
      ...(supportsEffort(caps) ? { effort: input.effort } : {}),
      format: { type: "json_schema" as const, schema: input.schema },
    },
  };
}

/**
 * A chamada em streaming, reduzida à mesma forma de resposta da não-streaming.
 *
 * `client.post(..., { stream: true })` devolve o `Stream` de eventos SSE do
 * SDK; `MessageStream` é o acumulador que remonta a mensagem final a partir
 * deles. Structured output em streaming não traz `parsed_output` — o JSON chega
 * como `text_delta` —, e é por isso que {@link extractJson} tem o caminho pelo
 * bloco de texto: aqui ele não é fallback, é a rota normal.
 */
async function postStreaming(
  client: Pick<Anthropic, "post">,
  body: StructuredRequestBody
): Promise<StructuredResponseBody> {
  const stream = (await client.post("/v1/messages", {
    body,
    stream: true,
  })) as Stream<unknown>;
  const message = await MessageStream.fromReadableStream(
    stream.toReadableStream()
  ).finalMessage();
  return message as unknown as StructuredResponseBody;
}

/**
 * Uma chamada estruturada. Devolve o JSON cru (a VALIDAÇÃO de forma é do
 * chamador — `lib/ingestion/*` tem os enums fechados do domínio) e a contagem
 * de tokens, que o chamador grava em `AIUsage` e acumula no cap do run.
 *
 * `latencyMs` mede a chamada INTEIRA, streaming incluído (do POST à mensagem
 * final) — é ele que o run grava no relatório para o orçamento da fatia deixar
 * de ser descoberto pelo log da Vercel.
 */
export async function runStructured<T = unknown>(
  input: StructuredCallInput,
  client?: Pick<Anthropic, "post">
): Promise<StructuredCallResult<T>> {
  const anthropic = client ?? getAnthropicClient();
  const body = buildStructuredRequest(input);

  const t0 = Date.now();
  const response = input.stream
    ? await postStreaming(anthropic, body)
    : ((await anthropic.post("/v1/messages", { body })) as StructuredResponseBody);
  const latencyMs = Date.now() - t0;

  return {
    data: extractJson(response) as T,
    model: response.model ?? input.model,
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
    },
    latencyMs,
  };
}

/** O que o pipeline de ingestão injeta — existe para o teste poder substituir. */
export type StructuredRunner = typeof runStructured;
