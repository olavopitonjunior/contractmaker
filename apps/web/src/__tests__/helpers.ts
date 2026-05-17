import type { AgentContext } from "@/lib/ai/types";

// --- AgentContext factory ---
export function createTestContext(
  overrides?: Partial<AgentContext>
): AgentContext {
  return {
    contractId: "contract-1",
    userId: "user-1",
    orgId: "org-1",
    htmlContent:
      '<div class="contrato"><h1>Contrato de Compra e Venda</h1><p>Valor: R$ 500.000,00</p></div>',
    dataJson: createTestContractData(),
    templateSource: "{{moeda pagamento.valor_total}}",
    activeClauses: [
      {
        id: "cc-1",
        clauseId: "clause-1",
        title: "Cláusula de Objeto",
        category: "objeto",
        position: 1,
        isActive: true,
      },
    ],
    ...overrides,
  };
}

// --- Contract data factory ---
export function createTestContractData(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    vendedores: [
      {
        nome: "João da Silva",
        cpf: "529.982.247-25",
        estado_civil: "Solteiro(a)",
      },
    ],
    compradores: [
      {
        nome: "Maria Oliveira",
        cpf: "453.178.287-91",
      },
    ],
    pagamento: {
      valor_total: 500000,
      sinal_arras: 50000,
      recursos_proprios: 200000,
      fgts: 0,
      cessao_consorcio: 0,
      alienacao_fiduciaria: 250000,
      outras_formas: 0,
    },
    config: {
      multa_penal_moratoria: "10%",
    },
    assinatura: {
      cidade: "São Paulo",
      data: "2026-04-10",
    },
    ...overrides,
  };
}

// --- Anthropic response factories ---

/**
 * Wraps a Message-like object to ALSO be async-iterable, yielding fake
 * streaming events that mimic the SDK's `MessageStreamEvent` sequence.
 * This is the bridge between the legacy test mocks (which return plain
 * Message objects) and the streaming agent runtime that does
 * `for await (const evt of stream)`.
 */
function makeStreamable<T extends { content: Array<Record<string, unknown>>; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }>(
  message: T
): T & AsyncIterable<unknown> {
  const iter = async function* (): AsyncGenerator<unknown> {
    yield {
      type: "message_start",
      message: { usage: { input_tokens: message.usage.input_tokens } },
    };
    for (let i = 0; i < message.content.length; i++) {
      const block = message.content[i];
      if (block.type === "text") {
        yield {
          type: "content_block_start",
          index: i,
          content_block: { type: "text" },
        };
        yield {
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: block.text },
        };
        yield { type: "content_block_stop", index: i };
      } else if (block.type === "tool_use") {
        yield {
          type: "content_block_start",
          index: i,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
          },
        };
        yield {
          type: "content_block_delta",
          index: i,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input ?? {}),
          },
        };
        yield { type: "content_block_stop", index: i };
      }
    }
    yield {
      type: "message_delta",
      delta: { stop_reason: message.stop_reason },
      usage: { output_tokens: message.usage.output_tokens },
    };
    yield { type: "message_stop" };
  };
  return Object.assign(message, {
    [Symbol.asyncIterator]: iter,
  }) as T & AsyncIterable<unknown>;
}

export function createAnthropicTextResponse(text: string) {
  return makeStreamable({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

export function createAnthropicToolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId = "toolu_test_1"
) {
  return makeStreamable({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: toolUseId,
        name: toolName,
        input,
      },
    ],
    model: "claude-sonnet-4-20250514",
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

// --- NextAuth session factory ---
export function createMockSession(overrides?: Record<string, unknown>) {
  return {
    user: {
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      ...overrides,
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

// --- Mock org factory ---
export function createMockOrg(overrides?: Record<string, unknown>) {
  return {
    id: "org-1",
    name: "Test Org",
    slug: "test-org",
    ...overrides,
  };
}
