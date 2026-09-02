import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/render/handlebars");

const { mockBatchUpdate, mockGetDocPlainText } = vi.hoisted(() => ({
  mockBatchUpdate: vi.fn(),
  mockGetDocPlainText: vi.fn(),
}));

vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: mockGetDocPlainText,
  batchUpdateDoc: (documentId: string, requests: unknown[]) =>
    mockBatchUpdate({ documentId, requestBody: { requests } }),
}));

import { reverseMergeDocToTemplate } from "../reverse-merge";

type ReplaceReq = { replaceAllText: { containsText: { text: string }; replaceText: string } };

/**
 * Docs simulado (mesmo desenho dos testes do passe de IA): `batchUpdate`
 * aplica os replaceAllText globalmente no estado e devolve
 * `occurrencesChanged` real; `getDocPlainText` lê o estado corrente.
 */
let state = "";
function useDoc(doc: string) {
  state = doc;
  mockGetDocPlainText.mockImplementation(async () => state);
  mockBatchUpdate.mockImplementation(async (arg: { requestBody: { requests: ReplaceReq[] } }) => {
    const replies = arg.requestBody.requests.map((r) => {
      const { text } = r.replaceAllText.containsText;
      const parts = state.split(text);
      const occurrencesChanged = parts.length - 1;
      state = parts.join(r.replaceAllText.replaceText);
      return { replaceAllText: { occurrencesChanged } };
    });
    return { data: { replies } };
  });
}

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

const run = (docId = "doc-1") => reverseMergeDocToTemplate({ docId, dataJson, modalidade: "locacao" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reverseMergeDocToTemplate — travas no texto plano", () => {
  it("substitui valores unívocos e pula ambíguos/curtos/stopwords", async () => {
    // "Bruno Tavares" aparece 2x (qualificação + assinatura) → ambíguo.
    // "São Paulo" é stopword. Valor do aluguel "R$ 3.500,00" é único.
    useDoc(
      [
        "CONTRATO",
        "Locatária: Bruno Tavares, CPF 529.982.247-25.",
        // NBSP depois do R$: é o que o helper `moeda` produz e o que um contrato
        // GERADO pelo sistema tem. Doc digitado à mão traz espaço comum e não
        // casa — fica para a especificidade (A6) normalizar dos dois lados.
        "O aluguel mensal é de R$\u00A03.500,00 (três mil e quinhentos reais).",
        "Foro de São Paulo. Cidade de São Paulo.",
        "Assinatura: Bruno Tavares",
      ].join("\n")
    );

    const result = await run();

    const replacedTokens = result.replaced.map((r) => r.token);
    expect(replacedTokens).toContain("aluguel_valor");
    expect(replacedTokens).toContain("aluguel_valor_extenso");
    expect(state).toContain("{{aluguel_valor}}");

    const skippedReasons = Object.fromEntries(result.skipped.map((s) => [s.value, s.reason]));
    expect(skippedReasons["Bruno Tavares"]).toBe("ambiguous");

    // Nenhuma request com stopword nem valor curto.
    const calls = mockBatchUpdate.mock.calls;
    expect(calls.length).toBe(1);
    const requests = calls[0][0].requestBody.requests as ReplaceReq[];
    for (const r of requests) {
      expect(r.replaceAllText.containsText.text.toLowerCase()).not.toBe("são paulo");
      expect(r.replaceAllText.containsText.text.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("longest-first: bloco composto sai antes do CPF contido nele", async () => {
    const qualText = "Helena Castro Vilaboim, inscrito(a) no CPF/MF sob nº 111.444.777-35";
    useDoc(`Locadora: ${qualText}. Texto fixo do contrato.`);

    const result = await run("doc-2");

    const qual = result.replaced.find((r) => r.token === "locadores_qualificacao");
    expect(qual).toBeTruthy();
    // O CPF vivia DENTRO do bloco já substituído — não pode ter ido pro batch
    // como substituição separada (ficaria órfão dentro do {{token}}).
    const cpfSeparado = result.replaced.find((r) => r.value === "111.444.777-35");
    expect(cpfSeparado).toBeUndefined();
    expect(state).toBe("Locadora: {{locadores_qualificacao}}. Texto fixo do contrato.");
  });

  it("sem nada substituível, não chama batchUpdate nem relê o Doc", async () => {
    useDoc("Documento sem dados do contrato.");
    const result = await run("doc-3");
    expect(result.replaced).toEqual([]);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockGetDocPlainText).toHaveBeenCalledTimes(1);
  });
});

/**
 * `replaced` só depois de conferir — o mesmo contrato do passe de IA (#498).
 */
describe("reverseMergeDocToTemplate — replaced só depois de conferir", () => {
  const DOC = "O aluguel mensal é de R$\u00A03.500,00 (três mil e quinhentos reais). Fim.";

  it("caminho feliz: confirmado pela reply E pela releitura (2 leituras do Doc)", async () => {
    useDoc(DOC);
    const result = await run();
    expect(result.replaced.map((r) => r.token)).toEqual(
      expect.arrayContaining(["aluguel_valor", "aluguel_valor_extenso"])
    );
    expect(mockGetDocPlainText).toHaveBeenCalledTimes(2);
  });

  it("replace-noop: a API casou zero — o texto plano mentiu", async () => {
    useDoc(DOC);
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real(arg);
      res.data.replies = res.data.replies.map(() => ({ replaceAllText: { occurrencesChanged: 0 } }));
      return res;
    });
    const result = await run();
    expect(result.replaced).toEqual([]);
    expect(result.skipped.filter((s) => s.reason === "replace-noop").length).toBeGreaterThan(0);
  });

  it("over-matched: a API casou mais de uma vez (rodapé) — não conta como substituído", async () => {
    useDoc(DOC);
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real(arg);
      res.data.replies[0] = { replaceAllText: { occurrencesChanged: 2 } };
      return res;
    });
    const result = await run();
    const first = mockBatchUpdate.mock.calls[0][0].requestBody.requests[0] as ReplaceReq;
    const over = result.skipped.find((s) => s.reason === "over-matched");
    expect(over?.value).toBe(first.replaceAllText.containsText.text);
    expect(result.replaced.map((r) => r.value)).not.toContain(first.replaceAllText.containsText.text);
  });

  it("verify-failed: a API disse que trocou, mas o Doc não mostra", async () => {
    useDoc(DOC);
    mockBatchUpdate.mockImplementation(async (arg: { requestBody: { requests: ReplaceReq[] } }) => ({
      data: { replies: arg.requestBody.requests.map(() => ({ replaceAllText: { occurrencesChanged: 1 } })) },
    }));
    const result = await run();
    expect(result.replaced).toEqual([]);
    expect(result.skipped.every((s) => s.reason === "verify-failed" || s.reason === "not-found" || s.reason === "too-short" || s.reason === "stopword" || s.reason === "ambiguous")).toBe(true);
    expect(result.skipped.some((s) => s.reason === "verify-failed")).toBe(true);
  });

  it("verify-unavailable: releitura falhou — 'não sei' não vira 'deu certo'", async () => {
    useDoc(DOC);
    mockGetDocPlainText.mockResolvedValueOnce(DOC).mockRejectedValueOnce(new Error("Drive 503"));
    const result = await run();
    expect(result.replaced).toEqual([]);
    expect(result.skipped.some((s) => s.reason === "verify-unavailable")).toBe(true);
  });

  it("batch-failed: o Google recusou o lote — nada substituído, nenhuma releitura", async () => {
    useDoc(DOC);
    mockBatchUpdate.mockRejectedValue(new Error("400"));
    const result = await run();
    expect(result.replaced).toEqual([]);
    expect(result.skipped.some((s) => s.reason === "batch-failed")).toBe(true);
    expect(mockGetDocPlainText).toHaveBeenCalledTimes(1);
  });
});
