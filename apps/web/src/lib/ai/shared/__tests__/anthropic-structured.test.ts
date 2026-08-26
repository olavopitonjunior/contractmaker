import { describe, it, expect, vi } from "vitest";
import { Stream } from "@anthropic-ai/sdk/streaming";
import {
  StructuredOutputError,
  StructuredOutputTruncatedError,
  runStructured,
} from "@/lib/ai/shared/anthropic-structured";
import {
  INGEST_CLASSIFY_MODEL,
  INGEST_ESCALATION_MODEL,
  INGEST_PLAN_MODEL,
} from "@/lib/ai/shared/models";
import { PRICING } from "@/lib/ai/usage";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function fakeClient(response: unknown) {
  const post = vi.fn().mockResolvedValue(response);
  return { client: { post } as never, post };
}

/**
 * Os eventos SSE de uma resposta estruturada em streaming, na ordem e na forma
 * que a API os manda: o `usage` chega PARTIDO (entrada em `message_start`,
 * saída em `message_delta`) e o JSON vem em `text_delta`, não em
 * `parsed_output`. É exatamente isso que o acumulador do SDK precisa remontar.
 */
function streamEvents(chunks: string[]): unknown[] {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_teste",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 21_000,
          output_tokens: 1,
          cache_read_input_tokens: 4_000,
          cache_creation_input_tokens: 900,
        },
      },
    },
    // O bloco de raciocínio do Opus 4.8 vem antes do texto e não pode
    // atrapalhar o parse.
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "…" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    ...chunks.map((text, i) => ({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text },
      chunk: i,
    })),
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1_500 },
    },
    { type: "message_stop" },
  ];
}

/**
 * Um cliente que devolve o `Stream` do SDK, como `client.post(..., {stream:
 * true})` devolve. Nenhum teste chega na API: o duplo é a fonte dos eventos, e
 * o acúmulo é o do SDK de verdade.
 */
function fakeStreamingClient(events: unknown[]) {
  const post = vi.fn(async (...args: unknown[]) => {
    void args;
    async function* iterate() {
      for (const event of events) yield event;
    }
    return new Stream(() => iterate()[Symbol.asyncIterator](), new AbortController());
  });
  return { client: { post } as never, post };
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    model: INGEST_CLASSIFY_MODEL,
    system: [
      { text: "regras estáveis", cache: true },
      { text: "extra volátil" },
    ],
    userContent: "documento",
    schema: SCHEMA,
    maxTokens: 1_000,
    effort: "low" as const,
    ...overrides,
  };
}

describe("cliente estruturado — o corpo da requisição", () => {
  it("NUNCA manda sampling param — é por isso que este caminho existe", async () => {
    const { client, post } = fakeClient({
      parsed_output: { ok: true },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    await runStructured(call(), client);

    const body = post.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("no modelo do PLANNER usa thinking adaptativo e effort — nada de budget_tokens", async () => {
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call({ model: INGEST_PLAN_MODEL, effort: "high" }), client);

    const body = post.mock.calls[0][1].body as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(body.output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: SCHEMA },
    });
  });

  it("no modelo do CLASSIFICADOR (Haiku 4.5) não manda thinking nem effort", async () => {
    // O 400 que derrubou o run: "adaptive thinking is not supported on this
    // model". O mesmo parâmetro é obrigatório no Opus 4.8 e proibido aqui.
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call({ model: INGEST_CLASSIFY_MODEL, effort: "low" }), client);

    const body = post.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).toEqual({
      format: { type: "json_schema", schema: SCHEMA },
    });
  });

  it("não faz prefill — a última mensagem é sempre do usuário", async () => {
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call(), client);

    const body = post.mock.calls[0][1].body as { messages: Array<{ role: string }> };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("marca o cache_control só no bloco declarado estável", async () => {
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call(), client);

    const body = post.mock.calls[0][1].body as {
      system: Array<{ cache_control?: unknown }>;
    };
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[1].cache_control).toBeUndefined();
  });
});

describe("cliente estruturado — a resposta", () => {
  it("prefere parsed_output", async () => {
    const { client } = fakeClient({
      parsed_output: { ok: true },
      content: [{ type: "text", text: '{"ok":false}' }],
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    const result = await runStructured<{ ok: boolean }>(call(), client);
    expect(result.data.ok).toBe(true);
  });

  it("cai no bloco de texto quando parsed_output não vem", async () => {
    const { client } = fakeClient({
      content: [
        { type: "thinking", thinking: "…" },
        { type: "text", text: '{"ok":true}' },
      ],
    });
    const result = await runStructured<{ ok: boolean }>(call(), client);
    expect(result.data.ok).toBe(true);
  });

  it("resposta que não é JSON vira erro tipado, não crash de JSON.parse", async () => {
    const { client } = fakeClient({ content: [{ type: "text", text: "desculpe, não" }] });
    await expect(runStructured(call(), client)).rejects.toBeInstanceOf(
      StructuredOutputError
    );
  });

  it("resposta CORTADA no teto de saída é diagnosticada como corte, não como JSON inválido", async () => {
    // A distinção não é cosmética: "não é JSON válido" manda quem lê procurar
    // defeito de formato, quando o que falta é espaço. O lote de 20 documentos
    // da Ativa perdeu um diagnóstico inteiro por causa dessa frase.
    const { client } = fakeClient({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"templates":[{"name":"Seguro-Fian' }],
    });
    const erro = await runStructured(call(), client).catch((e) => e);
    expect(erro).toBeInstanceOf(StructuredOutputTruncatedError);
    expect(erro).toBeInstanceOf(StructuredOutputError); // quem só quer o tipo base
    expect(erro.message).toMatch(/cortada no limite de tokens/);
  });

  it("corte é detectado ANTES de `parsed_output` — resposta cortada não traz plano bom", async () => {
    const { client } = fakeClient({
      stop_reason: "max_tokens",
      parsed_output: { ok: true },
    });
    await expect(runStructured(call(), client)).rejects.toBeInstanceOf(
      StructuredOutputTruncatedError
    );
  });

  it("`stop_reason` normal não atrapalha o caminho feliz", async () => {
    const { client } = fakeClient({
      stop_reason: "end_turn",
      parsed_output: { ok: true },
    });
    const result = await runStructured<{ ok: boolean }>(call(), client);
    expect(result.data.ok).toBe(true);
  });

  it("resposta sem conteúdo nenhum também é erro tipado", async () => {
    const { client } = fakeClient({ content: [] });
    await expect(runStructured(call(), client)).rejects.toBeInstanceOf(
      StructuredOutputError
    );
  });

  it("devolve os tokens de cache — sem eles o custo do lote seria superestimado", async () => {
    const { client } = fakeClient({
      parsed_output: { ok: true },
      model: "claude-haiku-4-5",
      usage: {
        input_tokens: 30,
        output_tokens: 7,
        cache_read_input_tokens: 4_000,
        cache_creation_input_tokens: 900,
      },
    });
    const result = await runStructured(call(), client);
    expect(result.usage).toEqual({
      promptTokens: 30,
      completionTokens: 7,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 900,
    });
    expect(result.model).toBe("claude-haiku-4-5");
  });
});

describe("cliente estruturado — streaming", () => {
  it("por padrão NÃO faz streaming — a classificação é curta", async () => {
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call(), client);

    const [, options] = post.mock.calls[0];
    expect((options as { body: Record<string, unknown> }).body).not.toHaveProperty("stream");
    expect(options).not.toHaveProperty("stream");
  });

  it("com stream:true o campo vai no CORPO e nas opções do post", async () => {
    const { client, post } = fakeStreamingClient(streamEvents(['{"ok":true}']));
    await runStructured(call({ model: INGEST_PLAN_MODEL, effort: "high", stream: true }), client);

    const [path, options] = post.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown>; stream?: boolean },
    ];
    expect(path).toBe("/v1/messages");
    // A API exige `stream` no corpo; o SDK exige na opção para parsear SSE.
    expect(options.body.stream).toBe(true);
    expect(options.stream).toBe(true);
  });

  it("remonta o JSON a partir dos text_delta, atravessando o bloco de raciocínio", async () => {
    const { client } = fakeStreamingClient(
      streamEvents(['{"ok"', ":tr", "ue}"])
    );
    const result = await runStructured<{ ok: boolean }>(
      call({ model: INGEST_PLAN_MODEL, effort: "high", stream: true }),
      client
    );
    expect(result.data.ok).toBe(true);
    expect(result.model).toBe("claude-opus-4-8");
  });

  it("junta o usage partido entre message_start e message_delta", async () => {
    // Sem isso o custo do plano sairia com `output_tokens: 1` — o valor
    // provisório do primeiro evento — e o cap do run nunca fecharia.
    const { client } = fakeStreamingClient(streamEvents(['{"ok":true}']));
    const result = await runStructured(
      call({ model: INGEST_PLAN_MODEL, effort: "high", stream: true }),
      client
    );
    expect(result.usage).toEqual({
      promptTokens: 21_000,
      completionTokens: 1_500,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 900,
    });
  });

  it("streaming sem bloco de texto vira erro tipado, não crash", async () => {
    const { client } = fakeStreamingClient(streamEvents([]));
    await expect(
      runStructured(call({ model: INGEST_PLAN_MODEL, effort: "high", stream: true }), client)
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });
});

describe("modelos da ingestão", () => {
  it("são os IDs atuais, sem sufixo de data", () => {
    expect(INGEST_CLASSIFY_MODEL).toBe("claude-haiku-4-5");
    expect(INGEST_PLAN_MODEL).toBe("claude-opus-4-8");
    expect(INGEST_ESCALATION_MODEL).toBe("claude-opus-5");
  });

  it("escalar por effort é de graça: os dois Opus custam igual por token", () => {
    expect(PRICING[INGEST_PLAN_MODEL]).toEqual(PRICING[INGEST_ESCALATION_MODEL]);
  });

  it("todos têm preço na tabela — sem isso o cap por run não seguraria nada", () => {
    for (const model of [
      INGEST_CLASSIFY_MODEL,
      INGEST_PLAN_MODEL,
      INGEST_ESCALATION_MODEL,
    ]) {
      expect(PRICING[model], model).toBeDefined();
      expect(PRICING[model].input, model).toBeGreaterThan(0);
    }
  });
});
