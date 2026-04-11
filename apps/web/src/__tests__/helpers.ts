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
export function createAnthropicTextResponse(text: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

export function createAnthropicToolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId = "toolu_test_1"
) {
  return {
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
  };
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
