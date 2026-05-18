import { describe, it, expect, vi, beforeEach } from "vitest";
import { runContractAgent } from "../agent";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  createAnthropicTextResponse,
  createAnthropicToolUseResponse,
} from "@/__tests__/helpers";

const mockPrisma = vi.mocked(prisma);

// Get the mocked Anthropic instance
let mockCreate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  // Get the mock create function from the Anthropic constructor
  const instance = new Anthropic();
  mockCreate = vi.mocked(instance.messages.create);

  // Default: contract exists with status "rascunho"
  mockPrisma.contract.findUniqueOrThrow.mockResolvedValue({
    id: "contract-1",
    status: "rascunho",
    htmlContent: "<p>Contrato</p>",
    dataJson: { vendedores: [] },
    templateOverride: null,
    template: { handlebarsSource: "{{moeda pagamento.valor_total}}" },
    clauses: [],
    userId: "user-1",
  } as any);

  // Default: no agent config
  mockPrisma.agentConfig.findUnique.mockResolvedValue(null);

  // Default: no chat session
  mockPrisma.chatSession.findFirst.mockResolvedValue(null);
  mockPrisma.chatSession.create.mockResolvedValue({
    id: "session-1",
  } as any);

  // Default: chat messages
  mockPrisma.chatMessage.createMany.mockResolvedValue({ count: 2 });

  // Default: changelog
  mockPrisma.contractChangeLog.createMany.mockResolvedValue({ count: 0 });

  // Default: contract update
  mockPrisma.contract.update.mockResolvedValue({} as any);
});

describe("runContractAgent", () => {
  // --- Status guard ---
  it("returns warning for approved contract without calling API", async () => {
    mockPrisma.contract.findUniqueOrThrow.mockResolvedValueOnce({
      id: "contract-1",
      status: "aprovado",
    } as any);

    const result = await runContractAgent({
      message: "test",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(result.message).toContain("aprovado");
    expect(result.htmlContent).toBeNull();
    expect(result.dataJson).toBeNull();
    expect(result.changeLogs).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // --- Single-turn (no tools) ---
  it("returns text response for simple end_turn", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("O contrato está correto.")
    );

    const result = await runContractAgent({
      message: "Verifique o contrato",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(result.message).toBe("O contrato está correto.");
    expect(result.htmlContent).toBeNull();
    expect(result.dataJson).toBeNull();
  });

  // --- Tool-use loop ---
  it("executes tool and returns final text", async () => {
    // First call: tool_use (query_knowledge_base com category="clause")
    mockCreate.mockResolvedValueOnce(
      createAnthropicToolUseResponse("query_knowledge_base", {
        query: "objeto",
        category: "clause",
      })
    );
    // Mock the knowledge-base query (fallback ILIKE pq sem Voyage no test)
    mockPrisma.knowledgeItem.findMany.mockResolvedValueOnce([]);

    // Second call: end_turn with text
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Encontrei 0 cláusulas na categoria objeto.")
    );

    const result = await runContractAgent({
      message: "Busque cláusulas de objeto",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.message).toBe(
      "Encontrei 0 cláusulas na categoria objeto."
    );
    expect(result.changeLogs).toHaveLength(1);
    expect(result.changeLogs[0].action).toBe("ai_query");
  });

  it("respects maxIterations limit (10)", async () => {
    // Always return tool_use to test the loop limit
    mockCreate.mockResolvedValue(
      createAnthropicToolUseResponse("query_knowledge_base", {
        query: "x",
        category: "clause",
      })
    );
    mockPrisma.knowledgeItem.findMany.mockResolvedValue([]);

    const result = await runContractAgent({
      message: "loop forever",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    // maxIterations baixou de 10 → 5 (expert-context + budget). O loop dá
    // `break` quando iterations >= maxIterations ANTES da próxima chamada, então:
    //   call 1 (initial) + 4 loop transitions = 5 calls total
    //   5 changeLogs (um por iteração, mesmo quando última não dispara mais call)
    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(result.changeLogs).toHaveLength(5);
  });

  // --- Persistence ---
  it("updates contract when edit tools are used", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicToolUseResponse("edit_contract_section", {
        target: "Contrato",
        replacement: "Contrato Atualizado",
      })
    );
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Seção editada.")
    );

    const result = await runContractAgent({
      message: "Edite a seção",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(result.changeLogs[0].action).toBe("ai_edit");
    expect(mockPrisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: expect.objectContaining({
          htmlContent: expect.any(String),
        }),
      })
    );
  });

  it("does NOT update contract for query-only tools", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicToolUseResponse("query_knowledge_base", {
        query: "x",
        category: "clause",
      })
    );
    mockPrisma.knowledgeItem.findMany.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Resultado da busca.")
    );

    await runContractAgent({
      message: "Busque clausulas",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  });

  it("creates chatSession if none exists", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Resposta")
    );

    await runContractAgent({
      message: "test",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockPrisma.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: "contract-1",
          userId: "user-1",
        }),
      })
    );
  });

  it("reuses existing chatSession", async () => {
    const existingSession = {
      id: "existing-session",
      messages: [{ role: "user", content: "hi", createdAt: new Date() }],
    } as any;

    // findFirst is called twice: once in loadChatHistory, once in session-save step
    mockPrisma.chatSession.findFirst
      .mockResolvedValueOnce(existingSession)  // loadChatHistory
      .mockResolvedValueOnce(existingSession); // session-save step

    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Resposta")
    );

    await runContractAgent({
      message: "test",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockPrisma.chatSession.create).not.toHaveBeenCalled();
  });

  it("saves user and assistant messages", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Resposta do agente")
    );

    await runContractAgent({
      message: "Pergunta do usuario",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockPrisma.chatMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Pergunta do usuario" }),
          expect.objectContaining({ role: "assistant", content: "Resposta do agente" }),
        ]),
      })
    );
  });

  it("creates changeLogs when tools are used", async () => {
    mockCreate.mockResolvedValueOnce(
      createAnthropicToolUseResponse("validate_contract", {})
    );
    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Validação concluída.")
    );

    await runContractAgent({
      message: "Valide o contrato",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    expect(mockPrisma.contractChangeLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            action: "validation",
            source: "ai",
          }),
        ]),
      })
    );
  });

  it("uses agent config from database when available", async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValueOnce({
      model: "claude-opus-4-20250514",
      temperature: 0.5,
      maxTokens: 8192,
      systemPrompt: "Custom prompt",
    } as any);

    mockCreate.mockResolvedValueOnce(
      createAnthropicTextResponse("Resposta")
    );

    await runContractAgent({
      message: "test",
      contractId: "contract-1",
      userId: "user-1",
      orgId: "org-1",
    });

    // system agora é array com cache_control ephemeral (introduzido pra
    // economizar tokens em chat multi-turn). Validamos só o text.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-20250514",
        temperature: 0.5,
        max_tokens: 8192,
        system: expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "Custom prompt" }),
        ]),
      })
    );
  });
});
