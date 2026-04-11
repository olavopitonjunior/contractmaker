import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyDocument, extractDocumentData } from "../ocr";
import { Anthropic } from "@anthropic-ai/sdk";

let mockCreate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  const instance = new Anthropic();
  mockCreate = vi.mocked(instance.messages.create);
});

describe("classifyDocument", () => {
  it("returns valid category from model response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "rg" }],
    });

    const result = await classifyDocument("base64data", "image/jpeg");
    expect(result).toBe("rg");
  });

  it("returns 'outro' for invalid response text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "something invalid" }],
    });

    const result = await classifyDocument("base64data", "image/jpeg");
    expect(result).toBe("outro");
  });

  it("returns 'outro' for non-text response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
    });

    const result = await classifyDocument("base64data", "image/png");
    expect(result).toBe("outro");
  });

  it("accepts all valid categories", async () => {
    const valid = ["rg", "cpf", "matricula", "iptu", "escritura", "procuracao", "outro"];
    for (const cat of valid) {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: cat }],
      });
      const result = await classifyDocument("data", "image/jpeg");
      expect(result).toBe(cat);
    }
  });

  it("passes image to Anthropic with correct structure", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "cpf" }],
    });

    await classifyDocument("mybase64", "image/png");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: expect.objectContaining({
                  type: "base64",
                  data: "mybase64",
                  media_type: "image/png",
                }),
              }),
            ]),
          }),
        ]),
      })
    );
  });
});

describe("extractDocumentData", () => {
  it("skips classification when category is provided", async () => {
    // Only one call (extraction), not two (classify + extract)
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"nome_completo": "João Silva", "cpf_numero": "12345678901"}' }],
    });

    const result = await extractDocumentData("data", "image/jpeg", "cpf");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.documentType).toBe("cpf");
  });

  it("calls classifyDocument first when no category", async () => {
    // First call: classify
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "rg" }],
    });
    // Second call: extract
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"nome_completo": "João"}' }],
    });

    const result = await extractDocumentData("data", "image/jpeg");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.documentType).toBe("rg");
  });

  it("parses JSON from response text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: 'Aqui está: {"nome_completo": "Maria", "rg_numero": "123456"}',
        },
      ],
    });

    const result = await extractDocumentData("data", "image/jpeg", "rg");

    expect(result.fields.nome_completo).toBe("Maria");
    expect(result.fields.rg_numero).toBe("123456");
  });

  it("falls back to raw_text on malformed JSON with braces", async () => {
    const malformed = "{this is not: valid json!!!}";
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: malformed }],
    });

    const result = await extractDocumentData("data", "image/jpeg", "rg");

    expect(result.fields.raw_text).toBe(malformed);
  });

  it("returns empty fields when response has no JSON-like content", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "plain text with no braces" }],
    });

    const result = await extractDocumentData("data", "image/jpeg", "rg");

    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it("calculates confidence based on filled fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"field1": "value1", "field2": "value2", "field3": null, "field4": ""}',
        },
      ],
    });

    const result = await extractDocumentData("data", "image/jpeg", "rg");

    // 2 filled out of 4 total = 0.5
    expect(result.confidence).toBe(0.5);
  });

  it("returns 0 confidence for empty fields object", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "{}" }],
    });

    const result = await extractDocumentData("data", "image/jpeg", "rg");

    expect(result.confidence).toBe(0);
  });

  it("returns rawText in result", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"nome": "Test"}' }],
    });

    const result = await extractDocumentData("data", "image/jpeg", "cpf");

    expect(result.rawText).toBe('{"nome": "Test"}');
  });
});
