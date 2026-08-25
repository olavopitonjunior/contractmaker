import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A cascata fim a fim quando o provedor primário não tem credencial.
 *
 * O teste unitário de `isConfigCredentialError` prova a CONDIÇÃO. Este prova o
 * COMPORTAMENTO: que o documento continua sendo extraído, por outro provedor, e
 * que a degradação deixa rastro.
 *
 * Sem isto, `GEMINI_OCR_MODEL=gpt-5.6-luna` sem `OPENAI_API_KEY` fazia 100% das
 * extrações falharem — o erro não casava nenhum padrão de fallback, então nem o
 * Gemini de fallback nem o último recurso Claude eram alcançados.
 */
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => {
  function MockGenAI() {
    return { models: { generateContent: mockGenerateContent } };
  }
  MockGenAI.prototype = {};
  return { GoogleGenAI: MockGenAI };
});
vi.mock("../usage", async (importActual) => ({
  ...(await importActual<typeof import("../usage")>()),
  recordAIUsage: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.GEMINI_API_KEY = "chave-gemini-de-teste";
  // O ponto do cenário: o modelo configurado é OpenAI e a chave dele NÃO existe.
  delete process.env.OPENAI_API_KEY;
  process.env.GEMINI_OCR_MODEL = "gpt-5.6-luna";
  mockGenerateContent.mockResolvedValue({
    text: '{"tipo":"matricula","campos":{"matricula_numero":"84512"},"confidence":0.9}',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

async function extrair() {
  const { classifyAndExtract } = await import("../ocr");
  return classifyAndExtract("YmFzZTY0", "image/png", undefined, {
    skipPrevalidation: true,
  });
}

describe("cascata quando o provedor primário está sem credencial", () => {
  it("F3: degrada para o Gemini em vez de apagar — o documento sai extraído", async () => {
    const r = await extrair();

    expect(r.documentType).toBe("matricula");
    expect(r.fields.matricula_numero).toBe("84512");
    // O fallback é Gemini, então o SDK do Google FOI chamado apesar de o
    // modelo configurado ser da OpenAI.
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it("F4: a degradação deixa rastro — config errada não pode ficar invisível", async () => {
    const erros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erros.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await extrair();

    const log = erros.join("\n");
    // Precisa dizer O QUE houve, QUAL modelo não rodou, e COMO conferir.
    expect(log).toContain("CONFIG");
    expect(log).toContain("gpt-5.6-luna");
    expect(log).toContain("GEMINI_OCR_MODEL");
    expect(log).toContain("verify-ocr.sh");
  });

  /**
   * O log é a única superfície nova que toca o erro do provedor — e essa é
   * justamente a classe de erro cujo corpo carrega material de chave: o 401 da
   * OpenAI devolve de volta o `sk-…` enviado. A versão anterior ecoava
   * `slice(0, 80)` do erro e só não vazava por aritmética: bastava o prefixo da
   * mensagem encurtar para o segredo entrar no log.
   */
  it("F4b: o log NÃO ecoa o corpo do erro, onde a chave viaja", async () => {
    process.env.GEMINI_OCR_MODEL = "gemini-3.5-flash-lite";
    mockGenerateContent
      .mockRejectedValueOnce(
        new Error(
          'got status: 401. {"error":{"message":"Incorrect API key provided: sk-proj-SEGREDO-QUE-NAO-PODE-VAZAR"}}'
        )
      )
      .mockResolvedValueOnce({
        text: '{"tipo":"matricula","campos":{"matricula_numero":"84512"},"confidence":0.9}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });

    const erros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erros.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await extrair();

    const log = erros.join("\n");
    expect(log).toContain("CONFIG");
    expect(log).toContain("HTTP 401");
    // O que importa: nada do corpo entra no log.
    expect(log).not.toContain("sk-proj-SEGREDO-QUE-NAO-PODE-VAZAR");
    expect(log).not.toContain("Incorrect API key");
  });

  /**
   * Os DOIS hops Gemini fora por credencial — o cenário que o código descreve
   * e que nenhum caso exercitava: `GEMINI_OCR_MODEL` num provedor sem chave E
   * `GEMINI_API_KEY` recusada.
   *
   * O Claude salva a extração (ele sempre tem chave, porque move o resto do
   * app) a ~10× o custo. Sem o log do segundo hop, ninguém descobre que DOIS
   * provedores estão quebrados — a conta só aparece na fatura.
   */
  it("F4c: segundo hop também grita quando o fallback cai por credencial", async () => {
    process.env.GEMINI_OCR_MODEL = "gemini-3.5-flash-lite";
    // Primário e fallback falham por credencial; o Claude (mock global) atende.
    const credencial = () =>
      Object.assign(new Error('{"error":{"code":403,"status":"PERMISSION_DENIED"}}'), {
        status: 403,
      });
    mockGenerateContent
      .mockRejectedValueOnce(credencial())
      .mockRejectedValueOnce(credencial());

    const erros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erros.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await extrair().catch(() => {
      // Se o Claude não atender neste ambiente, tudo bem: o que se afirma é o
      // LOG dos dois hops, não o sucesso da extração.
    });

    const log = erros.join("\n");
    expect(log).toContain("TAMBÉM falhou por credencial");
    expect(log).toContain("Dois provedores fora");
    expect(log).toContain("GEMINI_API_KEY");
    // O corpo do erro continua fora do log, nos dois hops.
    expect(log).not.toContain("PERMISSION_DENIED");
  });

  /**
   * O log de CONFIG é reservado a credencial. Falha comum do provedor — 500,
   * imagem ilegível — continua no `warn` de sempre, senão o sinal novo vira
   * ruído e some junto com o resto.
   *
   * Sem rede: o primário aqui é Gemini e quem falha é o mock.
   */
  it("falha comum do provedor não usa o log de CONFIG", async () => {
    process.env.GEMINI_OCR_MODEL = "gemini-3.5-flash-lite";
    mockGenerateContent
      .mockRejectedValueOnce(new Error("500 internal error"))
      .mockResolvedValueOnce({
        text: '{"tipo":"matricula","campos":{"matricula_numero":"84512"},"confidence":0.9}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });

    const erros: string[] = [];
    const avisos: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erros.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      avisos.push(a.map(String).join(" "));
    });

    const r = await extrair();

    expect(r.documentType).toBe("matricula");
    expect(erros.join("\n")).not.toContain("CONFIG:");
    expect(avisos.join("\n")).toContain("trying fallback");
  });
});
