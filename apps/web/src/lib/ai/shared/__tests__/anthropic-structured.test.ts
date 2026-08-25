import { describe, it, expect, vi } from "vitest";
import {
  StructuredOutputError,
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

  it("usa thinking adaptativo e effort — nada de budget_tokens (400 nesses modelos)", async () => {
    const { client, post } = fakeClient({ parsed_output: { ok: true } });
    await runStructured(call({ effort: "high" }), client);

    const body = post.mock.calls[0][1].body as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(body.output_config).toEqual({
      effort: "high",
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
