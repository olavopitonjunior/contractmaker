import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockBatchUpdate,
  mockGetDocPlainText,
  mockMessagesCreate,
} = vi.hoisted(() => ({
  mockBatchUpdate: vi.fn(),
  mockGetDocPlainText: vi.fn(),
  mockMessagesCreate: vi.fn(),
}));

vi.mock("@/lib/google/client", () => ({
  getDocsClient: () => ({ documents: { batchUpdate: mockBatchUpdate } }),
}));
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: mockGetDocPlainText,
}));
vi.mock("@/lib/ai/shared/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: mockMessagesCreate } }),
  SONNET_MODEL: "claude-sonnet-4-6",
}));
vi.mock("@/lib/ai/usage", () => ({
  recordAIUsage: vi.fn(),
}));

import { insertPlaceholdersWithAI } from "../ai-placeholder-insertion";

function aiResponse(mapeamentos: Array<{ trecho_literal: string; token: string }>) {
  return {
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [{ type: "text", text: JSON.stringify({ mapeamentos }) }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchUpdate.mockResolvedValue({ data: {} });
});

describe("insertPlaceholdersWithAI", () => {
  it("trecho ambíguo NUNCA vira request; token fora do catálogo é rejeitado", async () => {
    const doc = "Nome Igual aparece aqui. Nome Igual aparece de novo. Valor R$ 1.000,00 único.";
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        { trecho_literal: "Nome Igual", token: "locadores_qualificacao" },
        { trecho_literal: "R$ 1.000,00", token: "aluguel_valor" },
        { trecho_literal: "qualquer", token: "token_inventado" },
      ])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d1",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_valor"]);
    expect(report.skippedAmbiguous).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "locadores_qualificacao", reason: "ambiguous" }),
        expect.objectContaining({ token: "token_inventado", reason: "unknown-token" }),
      ])
    );
    const requests = mockBatchUpdate.mock.calls[0][0].requestBody.requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].replaceAllText.containsText.text).toBe("R$ 1.000,00");
  });

  it("bloco multi-parágrafo: 1º parágrafo vira token, demais únicos viram vazio, repetidos ficam no relatório", async () => {
    const doc = [
      "8.1. Primeira cláusula da garantia.",
      "8.2. Segunda cláusula única.",
      "____ linha repetida ____",
      "8.3. Terceira cláusula única.",
      "____ linha repetida ____",
    ].join("\n");
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        {
          trecho_literal:
            "8.1. Primeira cláusula da garantia.\n8.2. Segunda cláusula única.\n____ linha repetida ____\n8.3. Terceira cláusula única.",
          token: "clausula_garantia",
        },
      ])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d2",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.inserted).toHaveLength(1);
    expect(report.inserted[0].token).toBe("clausula_garantia");
    expect(report.inserted[0].leftoverParagraphs).toEqual(["____ linha repetida ____"]);

    const requests = mockBatchUpdate.mock.calls[0][0].requestBody.requests as Array<{
      replaceAllText: { containsText: { text: string }; replaceText: string };
    }>;
    const byText = Object.fromEntries(
      requests.map((r) => [r.replaceAllText.containsText.text, r.replaceAllText.replaceText])
    );
    expect(byText["8.1. Primeira cláusula da garantia."]).toBe("{{clausula_garantia}}");
    expect(byText["8.2. Segunda cláusula única."]).toBe("");
    expect(byText["8.3. Terceira cláusula única."]).toBe("");
    expect(byText["____ linha repetida ____"]).toBeUndefined();
  });

  it("multi-parágrafo com 1º parágrafo ambíguo: skip inteiro", async () => {
    const doc = "Linha dupla.\nLinha dupla.\nResto único.";
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        { trecho_literal: "Linha dupla.\nResto único.", token: "clausula_garantia" },
      ])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d3",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.inserted).toHaveLength(0);
    expect(report.skippedAmbiguous[0]).toEqual(
      expect.objectContaining({ token: "clausula_garantia", reason: "ambiguous" })
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  // ——— Trecho já tokenizado é intocável ———

  it("REGRESSÃO (Trio): não reescreve o trecho que contém {{slot_garantia}}", async () => {
    // Este pass roda DEPOIS do applyClauseSlot, então o token já está no doc.
    // O modelo mapeava o trecho ao redor pro legado {{clausula_garantia}} e
    // apagava o slot — o template ficava declarando um slot inexistente.
    const doc =
      "CLÁUSULA OITAVA - DA GARANTIA\n{{slot_garantia}}\nCLÁUSULA NONA - DO FORO";
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "{{slot_garantia}}", token: "clausula_garantia" }])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d4",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.inserted).toHaveLength(0);
    expect(report.skippedAmbiguous[0]).toEqual(
      expect.objectContaining({
        token: "clausula_garantia",
        reason: "already-tokenized",
      })
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("bloco multi-parágrafo que ENGLOBA um token é descartado inteiro", async () => {
    // O perigo aqui não é só perder o token do 1º parágrafo: os demais seriam
    // ESVAZIADOS, levando junto a cláusula ao redor.
    const doc =
      "CLÁUSULA OITAVA - DA GARANTIA\nA garantia é a seguinte:\n{{slot_garantia}}\nParágrafo final da cláusula.";
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        {
          trecho_literal:
            "A garantia é a seguinte:\n{{slot_garantia}}\nParágrafo final da cláusula.",
          token: "clausula_garantia",
        },
      ])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d5",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.skippedAmbiguous[0].reason).toBe("already-tokenized");
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("mapeamento legítimo segue passando quando o doc tem outros tokens", async () => {
    const doc =
      "{{slot_garantia}}\nO valor do aluguel é de R$ 3.500,00 mensais, reajustado anualmente.";
    mockGetDocPlainText.mockResolvedValue(doc);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "R$ 3.500,00", token: "aluguel_valor" }])
    );

    const report = await insertPlaceholdersWithAI({
      docId: "d6",
      modalidade: "locacao",
      orgId: "org-1",
    });

    expect(report.inserted).toEqual([
      expect.objectContaining({ token: "aluguel_valor" }),
    ]);
    expect(mockBatchUpdate).toHaveBeenCalled();
  });
});
