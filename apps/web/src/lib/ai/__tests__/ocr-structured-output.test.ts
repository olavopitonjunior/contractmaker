import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Structured output do OCR, no formato de DUAS ETAPAS.
 *
 * O que se protege são defeitos MEDIDOS contra a API e contra 10 documentos
 * reais em 24/08, cada um com um modo de falha silencioso diferente:
 *
 *   1. sem `enum` em `tipo`, o 3.5-flash-lite devolveu "matricula_imovel" e o
 *      3.1 devolveu "Matrícula de Imóvel" — `parseGeminiJson` rebaixa os dois a
 *      "outro", `suggestAssignment` cai em {outro,0} e o gate H.5 TRAVA o
 *      "Aplicar aos campos". O documento se perde por causa do rótulo.
 *   2. sem `nullable`, o campo ilegível volta como a string literal "null" e
 *      vira TEXTO no formulário.
 *   3. `campos: { type: "OBJECT" }` sem `properties` não dá erro: devolve
 *      `campos: {}` vazio, em silêncio. O OCR pararia de extrair sem sintoma.
 *   4. um schema SUPERSET (~55 campos de todas as categorias) suprime a
 *      extração — pior que não ter schema. Daí as duas etapas.
 */
const mockGenerateContent = vi.fn();

// `@anthropic-ai/sdk` já tem mock GLOBAL em src/__tests__/setup.ts — não
// redeclarar aqui, senão o local sobrescreve o global com uma versão pior.
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
  process.env.GEMINI_API_KEY = "test-key";
  mockGenerateContent.mockResolvedValue({
    text: '{"tipo":"matricula","campos":{"matricula_numero":"84512"},"confidence":0.9}',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function extrair() {
  const { classifyAndExtract } = await import("../ocr");
  return classifyAndExtract("YmFzZTY0", "image/png", undefined, {
    skipPrevalidation: true,
  });
}

/** Config da chamada de EXTRAÇÃO (a última). Com duas etapas, a 1a classifica. */
function configDaChamada(): Record<string, unknown> | undefined {
  const calls = mockGenerateContent.mock.calls;
  return calls[calls.length - 1]?.[0]?.config;
}

/** Config da chamada de CLASSIFICAÇÃO (a primeira). */
function configDaClassificacao(): Record<string, unknown> | undefined {
  return mockGenerateContent.mock.calls[0]?.[0]?.config;
}

describe("OCR_STRUCTURED_OUTPUT — flag", () => {
  /**
   * Nasce DESLIGADA. Ligar muda a extração de todo documento em produção — e
   * a primeira versão deste PR, com superset, teria PIORADO a extração se
   * tivesse ido ligada.
   */
  it("por padrão NÃO envia schema, e faz uma chamada só", async () => {
    delete process.env.OCR_STRUCTURED_OUTPUT;
    await extrair();
    expect(configDaChamada()).toBeUndefined();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("qualquer valor que não seja exatamente 'true' mantém desligado", async () => {
    process.env.OCR_STRUCTURED_OUTPUT = "1";
    await extrair();
    expect(configDaChamada()).toBeUndefined();
  });

  it("com OCR_STRUCTURED_OUTPUT=true envia o schema", async () => {
    process.env.OCR_STRUCTURED_OUTPUT = "true";
    await extrair();
    expect(configDaChamada()?.responseMimeType).toBe("application/json");
    expect(configDaChamada()?.responseSchema).toBeDefined();
  });
});

describe("schema POR CATEGORIA — a forma que o bench validou", () => {
  beforeEach(() => {
    process.env.OCR_STRUCTURED_OUTPUT = "true";
  });

  function schema(): Record<string, any> {
    return configDaChamada()?.responseSchema as Record<string, any>;
  }

  it("tipo é enum com as 11 categorias válidas", async () => {
    await extrair();
    const t = schema().properties.tipo;
    expect(t.enum).toContain("matricula");
    expect(t.enum).toHaveLength(11);
    expect(t.format).toBe("enum");
  });

  /**
   * O achado que reescreveu este PR: um schema com os ~55 campos de TODAS as
   * categorias SUPRIME a extração. Medido na mesma CNH — 11 campos sem schema,
   * 3 com o superset, 11 com o enxuto.
   */
  it("o schema é o da CATEGORIA, não um superset de todas", async () => {
    await extrair(); // o mock classifica como "matricula"
    const chaves = Object.keys(schema().properties.campos.properties);
    expect(chaves).toContain("matricula_numero");
    expect(chaves).toContain("proprietario_nome");
    expect(chaves).not.toContain("registro_cnh");
    expect(chaves).not.toContain("conjuge1_nome");
    expect(chaves.length).toBeLessThan(20);
  });

  it("classifica primeiro, com schema mínimo, e só então extrai", async () => {
    await extrair();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const cls = configDaClassificacao()?.responseSchema as Record<string, any>;
    expect(Object.keys(cls.properties)).toEqual(["tipo", "confidence"]);
    expect(cls.properties.campos).toBeUndefined();
  });

  /**
   * O defeito silencioso: OBJECT sem properties devolve `{}` e o OCR para de
   * extrair sem erro nenhum no log.
   */
  it("campos declara properties — OBJECT vazio devolveria {} em silêncio", async () => {
    await extrair();
    const campos = schema().properties.campos;
    expect(campos.type).toBe("OBJECT");
    expect(Object.keys(campos.properties ?? {}).length).toBeGreaterThan(5);
  });

  it("todo campo é nullable — senão volta a string 'null'", async () => {
    await extrair();
    const props = schema().properties.campos.properties;
    for (const chave of ["matricula_numero", "cartorio", "proprietario_nome"]) {
      expect(props[chave].nullable).toBe(true);
    }
  });

  it("campo de data declara o formato ISO que o input type=date exige", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"tipo":"rg","campos":{},"confidence":0.9}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    await extrair();
    const props = schema().properties.campos.properties;
    expect(String(props.data_nascimento.description)).toMatch(/YYYY-MM-DD/);
  });

  /**
   * `outro` e `ficha_resumo` seguem SEM schema de propósito. `outro` tem
   * contrato free-form no prompt, e medido: 22 campos sem schema contra 7 com
   * o enxuto. Documento fora do catálogo é onde menos se sabe o que vem.
   */
  it.each(["outro", "ficha_resumo"])(
    "%s extrai SEM schema — free-form é o contrato dele",
    async (cat) => {
      mockGenerateContent.mockResolvedValue({
        text: `{"tipo":"${cat}","campos":{},"confidence":0.9}`,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });
      await extrair();
      expect(configDaChamada()).toBeUndefined();
    }
  );

  /**
   * Num RG a única cidade impressa é a NATURALIDADE, mas `cidade`/`uf` mapeiam
   * para o ENDEREÇO em FIELD_MAP_PERSON — o local de nascimento aterrissaria
   * no endereço, e o guard de null não pega porque o valor é string legítima.
   */
  it("cidade e uf avisam que são do endereço, não da naturalidade", async () => {
    await extrair(); // "matricula" tem cidade/uf
    const props = schema().properties.campos.properties;
    expect(String(props.cidade.description)).toMatch(/ENDERECO/i);
    expect(String(props.cidade.description)).toMatch(/naturalidade/i);
  });

  it("NUNCA envia thinkingConfig — o Gemma responde 400", async () => {
    await extrair();
    expect(configDaChamada()).not.toHaveProperty("thinkingConfig");
  });

  /**
   * A etapa 1 é auxiliar: se ela falhar, a extração segue SEM schema, que é o
   * comportamento de produção hoje. Degradar é melhor que derrubar por causa
   * de uma chamada de apoio.
   */
  it("classificação que falha degrada para extração sem schema", async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error("got status: 503"))
      .mockResolvedValueOnce({
        text: '{"tipo":"rg","campos":{"nome_completo":"Joao"},"confidence":0.8}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });
    const r = await extrair();
    expect(r.documentType).toBe("rg");
    expect(configDaChamada()).toBeUndefined();
  });

  /**
   * O custo soma as DUAS chamadas. Cobrar só a extração esconderia o preço da
   * classificação, que é exatamente o custo deste formato.
   */
  it("o uso reportado soma as duas etapas", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"tipo":"matricula","campos":{},"confidence":0.9}',
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 125,
      },
    });
    const { recordAIUsage } = await import("../usage");
    const { classifyAndExtract } = await import("../ocr");
    await classifyAndExtract("YmFzZTY0", "image/png", { orgId: "org-1" }, {
      skipPrevalidation: true,
    });
    expect(recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 200, completionTokens: 50 })
    );
  });
});

describe("degradação quando o modelo recusa o schema", () => {
  /**
   * O modo de falha mais caro: `shouldTryFallbackModel` só casa 5xx/safety/
   * decode, então um 400 de schema pularia o fallback do Gemini E o último
   * recurso no Claude — 100% das extrações falhariam. E trocar de modelo não
   * ajudaria: o fallback receberia o MESMO schema.
   */
  it("400 de schema repete SEM structured output em vez de derrubar o OCR", async () => {
    process.env.OCR_STRUCTURED_OUTPUT = "true";
    mockGenerateContent
      // etapa 1 (classificação) passa
      .mockResolvedValueOnce({
        text: '{"tipo":"rg","confidence":0.9}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      })
      // etapa 2 recusa o schema
      .mockRejectedValueOnce(
        new Error("got status: 400 INVALID_ARGUMENT. responseSchema is not supported")
      )
      // retentativa sem schema
      .mockResolvedValueOnce({
        text: '{"tipo":"rg","campos":{"nome_completo":"Joao"},"confidence":0.8}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });

    const r = await extrair();
    expect(r.documentType).toBe("rg");
    // A ÚLTIMA chamada vai SEM config — é a degradação, não outra tentativa igual.
    expect(configDaChamada()).toBeUndefined();
  });

  it("com a flag desligada, um 400 continua propagando como antes", async () => {
    delete process.env.OCR_STRUCTURED_OUTPUT;
    mockGenerateContent.mockRejectedValue(
      new Error("got status: 400 INVALID_ARGUMENT schema")
    );
    await expect(extrair()).rejects.toThrow();
  });
});

describe("parse continua tolerante com o schema ligado", () => {
  /**
   * O Gemma emite uma cerca markdown sobrando em ~1/3 das chamadas, mesmo com
   * schema. `JSON.parse` estrito quebraria; o regex de `parseGeminiJson` corta
   * a sobra. Endurecer o parse enquanto o Gemma for candidato o eliminaria por
   * um defeito de formatação, não de leitura.
   */
  it("cerca markdown sobrando não perde o documento", async () => {
    process.env.OCR_STRUCTURED_OUTPUT = "true";
    mockGenerateContent.mockResolvedValue({
      text: '{"tipo":"matricula","campos":{"matricula_numero":"84512"},"confidence":1}\n```',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const r = await extrair();
    expect(r.documentType).toBe("matricula");
    expect(r.fields.matricula_numero).toBe("84512");
  });
});
