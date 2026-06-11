import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/render/handlebars");

const { mockBatchUpdate, mockGetDocPlainText } = vi.hoisted(() => ({
  mockBatchUpdate: vi.fn(),
  mockGetDocPlainText: vi.fn(),
}));

vi.mock("@/lib/google/client", () => ({
  getDocsClient: () => ({ documents: { batchUpdate: mockBatchUpdate } }),
}));
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: mockGetDocPlainText,
}));

import { reverseMergeDocToTemplate } from "../reverse-merge";

const dataJson = {
  locadores: [{ tipo_pessoa: "fisica", nome: "Helena Castro Vilaboim", cpf: "11144477735" }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Bruno Tavares", cpf: "52998224725" }],
  imovel: {
    rua: "Avenida Faria Lima",
    numero: "3500",
    cidade: "São Paulo",
    uf: "SP",
    cep: "04538132",
    descricao: "Apartamento de 3 dormitórios.",
  },
  aluguel: { valor: 3500, dia_vencimento: 10, indice_reajuste: "IGPM", vigencia_meses: 30 },
  garantia: { tipo: "sem_garantia" },
  config: { multa_atraso_percent: 10, juros_mensais_atraso: 1, multa_rescisoria_meses: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchUpdate.mockResolvedValue({ data: {} });
});

describe("reverseMergeDocToTemplate", () => {
  it("substitui valores unívocos e pula ambíguos/curtos/stopwords", async () => {
    // "Bruno Tavares" aparece 2x (qualificação + assinatura) → ambíguo.
    // "São Paulo" é stopword. Valor do aluguel "R$ 3.500,00" é único.
    mockGetDocPlainText.mockResolvedValue(
      [
        "CONTRATO",
        "Locatária: Bruno Tavares, CPF 529.982.247-25.",
        "O aluguel mensal é de R$ 3.500,00 (três mil e quinhentos reais).",
        "Foro de São Paulo. Cidade de São Paulo.",
        "Assinatura: Bruno Tavares",
      ].join("\n")
    );

    const result = await reverseMergeDocToTemplate({
      docId: "doc-1",
      dataJson,
      modalidade: "locacao",
    });

    const replacedTokens = result.replaced.map((r) => r.token);
    expect(replacedTokens).toContain("aluguel_valor");
    expect(replacedTokens).toContain("aluguel_valor_extenso");

    const skippedReasons = Object.fromEntries(
      result.skipped.map((s) => [s.value, s.reason])
    );
    expect(skippedReasons["Bruno Tavares"]).toBe("ambiguous");

    // Nenhuma request com stopword nem valor curto.
    const calls = mockBatchUpdate.mock.calls;
    expect(calls.length).toBe(1);
    const requests = calls[0][0].requestBody.requests as Array<{
      replaceAllText: { containsText: { text: string } };
    }>;
    for (const r of requests) {
      expect(r.replaceAllText.containsText.text.toLowerCase()).not.toBe("são paulo");
      expect(r.replaceAllText.containsText.text.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("longest-first: bloco composto sai antes do CPF contido nele", async () => {
    const qualText =
      "Helena Castro Vilaboim, inscrito(a) no CPF/MF sob nº 111.444.777-35";
    mockGetDocPlainText.mockResolvedValue(
      `Locadora: ${qualText}. Texto fixo do contrato.`
    );

    const result = await reverseMergeDocToTemplate({
      docId: "doc-2",
      dataJson,
      modalidade: "locacao",
    });

    const qual = result.replaced.find((r) => r.token === "locadores_qualificacao");
    expect(qual).toBeTruthy();
    // O CPF vivia DENTRO do bloco já substituído — não pode ter ido pro batch
    // como substituição separada (ficaria órfão dentro do {{token}}).
    const cpfSeparado = result.replaced.find((r) => r.value === "111.444.777-35");
    expect(cpfSeparado).toBeUndefined();
  });

  it("sem nada substituível, não chama batchUpdate", async () => {
    mockGetDocPlainText.mockResolvedValue("Documento sem dados do contrato.");
    const result = await reverseMergeDocToTemplate({
      docId: "doc-3",
      dataJson,
      modalidade: "locacao",
    });
    expect(result.replaced).toEqual([]);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });
});
