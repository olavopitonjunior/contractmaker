import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCcvJson } from "../ccv-extractor";

// Mock GoogleGenAI antes de importar a função que o usa
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI };
});

vi.mock("@/lib/ai/usage", () => ({
  recordAIUsage: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

describe("parseCcvJson", () => {
  it("extrai JSON puro", () => {
    const raw = '{"modalidade":"a_vista","vendedores":[]}';
    expect(parseCcvJson(raw)).toEqual({ modalidade: "a_vista", vendedores: [] });
  });

  it("extrai JSON envolvido em markdown ```json", () => {
    const raw = '```json\n{"modalidade":"financiamento"}\n```';
    expect(parseCcvJson(raw)).toEqual({ modalidade: "financiamento" });
  });

  it("retorna {} para texto sem JSON", () => {
    expect(parseCcvJson("nenhum json aqui")).toEqual({});
  });

  it("retorna {} para JSON malformado", () => {
    expect(parseCcvJson('{"modalidade": "a_vista", "vendedores": [')).toEqual({});
  });

  it("retorna {} para arrays (rejeita root não-objeto)", () => {
    expect(parseCcvJson("[1,2,3]")).toEqual({});
  });
});

describe("extractCcvDataJson", () => {
  it("retorna {} para mime não suportado", async () => {
    const { extractCcvDataJson } = await import("../ccv-extractor");
    const result = await extractCcvDataJson(
      Buffer.from("xxx"),
      // @ts-expect-error testando branch defensivo
      "application/zip",
      { orgId: "org-1" }
    );
    expect(result).toEqual({});
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("chama Gemini e parseia o JSON retornado", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '{"modalidade":"a_vista","vendedores":[{"nome":"João"}]}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const { extractCcvDataJson } = await import("../ccv-extractor");
    const result = await extractCcvDataJson(
      Buffer.from("%PDF-1.4 fake"),
      "application/pdf",
      { orgId: "org-1", userId: "user-1" }
    );

    expect(result).toEqual({
      modalidade: "a_vista",
      vendedores: [{ nome: "João" }],
    });

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.contents).toHaveLength(2);
    expect(call.contents[1].inlineData.mimeType).toBe("application/pdf");
  });

  it("retorna {} quando Gemini lança erro (best-effort)", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("network down"));

    const { extractCcvDataJson } = await import("../ccv-extractor");
    const result = await extractCcvDataJson(
      Buffer.from("%PDF-1.4"),
      "application/pdf",
      { orgId: "org-1" }
    );
    expect(result).toEqual({});
  });

  it("registra AIUsage com operation extract_ccv_doc", async () => {
    const { recordAIUsage } = await import("@/lib/ai/usage");
    mockGenerateContent.mockResolvedValueOnce({
      text: "{}",
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const { extractCcvDataJson } = await import("../ccv-extractor");
    await extractCcvDataJson(Buffer.from("%PDF-1.4"), "application/pdf", {
      orgId: "org-1",
      userId: "user-1",
    });

    expect(recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gemini",
        operation: "extract_ccv_doc",
        success: true,
        promptTokens: 10,
        completionTokens: 5,
      })
    );
  });
});
