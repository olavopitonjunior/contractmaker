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
/**
 * `exportNormalizes`: como o Drive de verdade — `drive.files.export text/plain`
 * devolve espaço comum onde o Doc tem NBSP; o `replaceAllText` continua casando
 * contra o Doc (com NBSP).
 */
function useDoc(doc: string, opts: { exportNormalizes?: boolean } = {}) {
  state = doc;
  mockGetDocPlainText.mockImplementation(async () =>
    opts.exportNormalizes ? state.replace(/\u00A0/g, " ") : state
  );
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

    // "Bruno Tavares" é a chave crua do flatten (`locatarios_nome`), fora do
    // catálogo: nem candidato é — não aparece em replaced NEM em skipped.
    // A qualificação inteira (token composto do catálogo) é o caminho certo.
    const touched = [...result.replaced, ...result.skipped].map((x) => x.value);
    expect(touched).not.toContain("Bruno Tavares");
    expect(state).toContain("Bruno Tavares");

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

  it("temporada usa o mapa de LOCAÇÃO (família, não prefixo 'locacao')", async () => {
    useDoc("O aluguel é de R$\u00A03.500,00 por temporada.");
    const result = await reverseMergeDocToTemplate({ docId: "d", dataJson, modalidade: "temporada" });
    expect(result.replaced.map((r) => r.token)).toContain("aluguel_valor");
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
 * Especificidade (A6): quando trocar TODAS as ocorrências. O par (token, valor)
 * decide — `matchPolicy: "all"` no catálogo E `isSpecificValue(valor)`.
 */
describe("reverseMergeDocToTemplate — matchPolicy all × unique", () => {
  it("valor do aluguel repetido em 3 cláusulas: token `all` + valor específico → TODAS viram chave", async () => {
    useDoc(
      "1. Aluguel de R$ 3.500,00 mensais.\n2. Reajuste sobre R$ 3.500,00.\n3. Multa calculada sobre R$ 3.500,00 devidos."
    );
    const result = await run();
    const r = result.replaced.find((x) => x.token === "aluguel_valor");
    expect(r?.occurrences).toBe(3);
    expect(state.split("{{aluguel_valor}}")).toHaveLength(4);
    expect(state).not.toContain("3.500,00");
  });

  it("token `unique` com valor repetido continua ambíguo (imovel_descricao)", async () => {
    // "Apartamento de 3 dormitórios." é a descrição do dataJson; `imovel_descricao`
    // é `unique` no catálogo: repetido → ambíguo, e o texto fica intacto.
    useDoc("Apartamento de 3 dormitórios. Vistoria: Apartamento de 3 dormitórios. Fim.");
    const result = await run();
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "imovel_descricao", reason: "ambiguous", occurrences: 2 }),
      ])
    );
    expect(state).not.toContain("{{imovel_descricao}}");
  });

  it("token `all` com valor repetido mas GENÉRICO → not-specific (não corrompe o texto fixo)", async () => {
    const data = { ...dataJson, imovel: { ...dataJson.imovel, matricula: "Bloco A" } };
    useDoc("Matrícula: Bloco A. O Bloco A tem elevador. Fim.");
    const result = await reverseMergeDocToTemplate({ docId: "d", dataJson: data, modalidade: "locacao" });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "imovel_matricula", reason: "not-specific", occurrences: 2 }),
      ])
    );
    expect(state).not.toContain("{{imovel_matricula}}");
    // Controle: o mesmo token com valor específico e repetido entra em todas.
    // (≥ 40 chars: específico por comprimento)
    const MAT = "152.834 do 5º Registro de Imóveis de São Paulo/SP";
    const data2 = { ...dataJson, imovel: { ...dataJson.imovel, matricula: MAT } };
    useDoc(`Matrícula ${MAT}. Averbada na ${MAT}.`);
    const r2 = await reverseMergeDocToTemplate({ docId: "d", dataJson: data2, modalidade: "locacao" });
    expect(r2.replaced.find((x) => x.token === "imovel_matricula")?.occurrences).toBe(2);
  });

  it("NBSP ≡ espaço: Doc digitado com espaço comum casa o valor com NBSP, e o request vai com o texto do Doc", async () => {
    useDoc("O aluguel é de R$ 3.500,00 mensais."); // espaço comum
    const result = await run();
    expect(result.replaced.map((x) => x.token)).toContain("aluguel_valor");
    const forms = (mockBatchUpdate.mock.calls[0][0].requestBody.requests as ReplaceReq[])
      .filter((r) => r.replaceAllText.replaceText === "{{aluguel_valor}}")
      .map((r) => r.replaceAllText.containsText.text);
    expect(forms).toContain("R$ 3.500,00"); // a literal do Doc está entre as formas
    expect(state).toContain("{{aluguel_valor}}");
  });

  it("export do Drive normaliza o NBSP: o request leva a forma do mapa (NBSP) e casa no Doc — medido em staging", async () => {
    // Doc gerado pelo sistema tem NBSP; o texto exportado vem com espaço comum.
    useDoc("Preço: R$\u00A03.500,00. Reajuste sobre R$\u00A03.500,00.", { exportNormalizes: true });
    const result = await run();
    expect(result.replaced.find((x) => x.token === "aluguel_valor")?.occurrences).toBe(2);
    expect(state).not.toContain("3.500,00");
    const forms = (mockBatchUpdate.mock.calls[0][0].requestBody.requests as ReplaceReq[])
      .filter((r) => r.replaceAllText.replaceText === "{{aluguel_valor}}")
      .map((r) => r.replaceAllText.containsText.text);
    // Duas formas distintas: a exportada (espaço) e a do mapa/toda-NBSP. Só a segunda casa.
    expect(forms).toHaveLength(2);
    expect(forms).toContain("R$\u00A03.500,00");
    expect(result.skipped.find((s) => s.token === "aluguel_valor")).toBeUndefined();
  });

  it("gabarito com espaço comum × Doc com NBSP (export normaliza): a variante R$+NBSP casa", async () => {
    // Valor do mapa forçado a espaço comum via dataJson pré-formatado não existe;
    // simular pelo caminho inverso: Doc com NBSP, export normalizado, e conferir
    // que entre as formas enviadas há a de NBSP mesmo quando o mapa vem com espaço.
    useDoc("Aluguel: R$\u00A03.500,00 mensais.", { exportNormalizes: true });
    const result = await run();
    expect(result.replaced.map((x) => x.token)).toContain("aluguel_valor");
    const forms = (mockBatchUpdate.mock.calls[0][0].requestBody.requests as ReplaceReq[])
      .filter((r) => r.replaceAllText.replaceText === "{{aluguel_valor}}")
      .map((r) => r.replaceAllText.containsText.text);
    expect(forms).toContain("R$ 3.500,00"); // exportada/normalizada
    expect(forms).toContain("R$\u00A03.500,00"); // toda-NBSP (e a do mapa)
    expect(state).toContain("{{aluguel_valor}}");
  });

  it("maskReverseMergeReport mascara os valores de replaced e skipped", async () => {
    const { maskReverseMergeReport } = await import("../reverse-merge");
    const out = maskReverseMergeReport({
      replaced: [{ token: "locadores_qualificacao", value: "Ana, CPF 529.982.247-25", occurrences: 1 }],
      skipped: [{ token: "x", value: "Agência 1234 Conta 68233198-6", reason: "ambiguous", occurrences: 2 }],
    });
    expect(JSON.stringify(out)).not.toContain("529.982.247-25");
    expect(out.replaced[0].value).toContain("000.000.000-00");
    expect(out.skipped[0].occurrences).toBe(2);
  });

  it("formas mistas (NBSP e espaço) no mesmo Doc: uma request por forma, tudo confirmado", async () => {
    useDoc("Preço: R$\u00A03.500,00. Reajuste sobre R$ 3.500,00.", { exportNormalizes: true });
    const result = await run();
    expect(result.replaced.find((x) => x.token === "aluguel_valor")?.occurrences).toBe(2);
    const forms = (mockBatchUpdate.mock.calls[0][0].requestBody.requests as ReplaceReq[])
      .filter((r) => r.replaceAllText.replaceText === "{{aluguel_valor}}")
      .map((r) => r.replaceAllText.containsText.text);
    expect(forms).toHaveLength(2);
    expect(state).not.toContain("3.500,00");
  });

  it("over-matched compara com as ocorrências ESPERADAS: 3 esperadas e 3 trocadas não é over-matched", async () => {
    useDoc("R$\u00A03.500,00 a. R$ 3.500,00 b. R$\u00A03.500,00 c.", { exportNormalizes: true });
    const result = await run();
    expect(result.skipped.find((s) => s.reason === "over-matched")).toBeUndefined();
    expect(result.replaced.find((x) => x.token === "aluguel_valor")?.occurrences).toBe(3);
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
    // 1 ocorrência na PRIMEIRA forma de cada valor (as demais formas, 0) — soma
    // = esperado, para cair na releitura e não em over-matched.
    mockBatchUpdate.mockImplementation(async (arg: { requestBody: { requests: ReplaceReq[] } }) => {
      const seen = new Set<string>();
      return {
        data: {
          replies: arg.requestBody.requests.map((r) => {
            const first = !seen.has(r.replaceAllText.replaceText);
            seen.add(r.replaceAllText.replaceText);
            return { replaceAllText: { occurrencesChanged: first ? 1 : 0 } };
          }),
        },
      };
    });
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
