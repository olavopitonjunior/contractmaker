/**
 * Fallback de modelo em sobrecarga.
 *
 * `AgentProfile.fallbackModel` é gravado e resolvido desde o console de
 * agentes — e nunca foi consumido por ninguém. O cliente da Anthropic era um
 * singleton sem retry: um `529` matava o turn e o usuário via erro.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isOverloadedError } from "../shared/anthropic-client";
import { streamOneTurn } from "../shared/turn";

const create = vi.fn();
vi.mock("../shared/anthropic-client", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getAnthropicClient: () => ({ messages: { create } }),
  };
});

/** Stream mínimo: um bloco de texto e fim. */
function fakeStream(texto: string) {
  return (async function* () {
    yield { type: "message_start", message: { usage: { input_tokens: 10 } } };
    yield { type: "content_block_start", content_block: { type: "text" } };
    yield { type: "content_block_delta", delta: { type: "text_delta", text: texto } };
    yield { type: "content_block_stop" };
    yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } };
  })();
}

function erro(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

const PARAMS = {
  model: "claude-sonnet-4-6",
  max_tokens: 100,
  messages: [{ role: "user" as const, content: "oi" }],
  stream: true as const,
};

async function drena(gen: AsyncGenerator<unknown, unknown, void>) {
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return r.value;
}

beforeEach(() => vi.clearAllMocks());

describe("isOverloadedError", () => {
  it("reconhece 429 e 529", () => {
    expect(isOverloadedError(erro(429))).toBe(true);
    expect(isOverloadedError(erro(529))).toBe(true);
  });

  it("reconhece pelo `type` quando não há status", () => {
    expect(isOverloadedError({ type: "overloaded_error" })).toBe(true);
    expect(isOverloadedError({ type: "rate_limit_error" })).toBe(true);
  });

  it("NÃO trata erro de pedido inválido como sobrecarga", () => {
    // 400 significa que o pedido estava errado — repetir noutro modelo só
    // gastaria token pra receber o mesmo 400.
    expect(isOverloadedError(erro(400))).toBe(false);
    expect(isOverloadedError(erro(401))).toBe(false);
    expect(isOverloadedError(new Error("qualquer coisa"))).toBe(false);
  });
});

describe("streamOneTurn com fallback", () => {
  it("em 529, repete UMA vez no modelo de contingência", async () => {
    create.mockRejectedValueOnce(erro(529)).mockResolvedValueOnce(fakeStream("ok"));
    const avisos: unknown[] = [];

    await drena(
      streamOneTurn(PARAMS, {
        fallbackModel: "claude-haiku-4-5-20251001",
        onFallback: (i) => avisos.push(i),
      })
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].model).toBe("claude-haiku-4-5-20251001");
    expect(avisos).toEqual([
      { from: "claude-sonnet-4-6", to: "claude-haiku-4-5-20251001", reason: "HTTP 529" },
    ]);
  });

  it("sem fallback configurado, o erro sobe como antes", async () => {
    create.mockRejectedValueOnce(erro(429));
    await expect(drena(streamOneTurn(PARAMS, {}))).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("erro que NÃO é sobrecarga não aciona o fallback", async () => {
    create.mockRejectedValueOnce(erro(400));
    await expect(
      drena(streamOneTurn(PARAMS, { fallbackModel: "claude-haiku-4-5-20251001" }))
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fallback igual ao principal não é fallback — não repete", async () => {
    // Repetir no MESMO modelo sobrecarregado só dobra a espera de quem está
    // olhando a tela.
    create.mockRejectedValueOnce(erro(529));
    await expect(
      drena(streamOneTurn(PARAMS, { fallbackModel: "claude-sonnet-4-6" }))
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("não é cadeia: se o fallback também estoura, o erro sobe", async () => {
    create.mockRejectedValueOnce(erro(529)).mockRejectedValueOnce(erro(529));
    await expect(
      drena(streamOneTurn(PARAMS, { fallbackModel: "claude-haiku-4-5-20251001" }))
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
