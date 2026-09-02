import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBatchUpdate, mockGetDocPlainText, mockMessagesCreate } = vi.hoisted(() => ({
  mockBatchUpdate: vi.fn(),
  mockGetDocPlainText: vi.fn(),
  mockMessagesCreate: vi.fn(),
}));

vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: mockGetDocPlainText,
  // Mesmo shape que o código antigo chamava direto no client — os testes
  // continuam lendo `mock.calls[0][0].requestBody.requests`.
  batchUpdateDoc: (documentId: string, requests: unknown[]) =>
    mockBatchUpdate({ documentId, requestBody: { requests } }),
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

type ReplaceReq = { replaceAllText: { containsText: { text: string }; replaceText: string } };

/**
 * Docs simulado: `batchUpdate` aplica os replaceAllText GLOBALMENTE no estado e
 * devolve `occurrencesChanged` real; `getDocPlainText` lê o estado corrente.
 * Assim a releitura do passe enxerga o que o batch fez — e os testes de
 * "a API disse X mas o Doc mostra Y" só precisam mexer num dos dois lados.
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

const run = (docId = "d1") =>
  insertPlaceholdersWithAI({ docId, modalidade: "locacao", orgId: "org-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("insertPlaceholdersWithAI — travas no texto plano", () => {
  it("trecho ambíguo NUNCA vira request; token fora do catálogo é rejeitado", async () => {
    useDoc("Nome Igual aparece aqui. Nome Igual aparece de novo. Valor R$ 1.000,00 único.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        { trecho_literal: "Nome Igual", token: "locadores_qualificacao" },
        { trecho_literal: "R$ 1.000,00", token: "aluguel_valor" },
        { trecho_literal: "qualquer", token: "token_inventado" },
      ])
    );

    const report = await run();

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
    expect(state).toContain("{{aluguel_valor}}");
  });

  it("bloco multi-parágrafo: 1º parágrafo vira token, demais únicos viram vazio, repetidos ficam no relatório", async () => {
    useDoc(
      [
        "8.1. Primeira cláusula da garantia.",
        "8.2. Segunda cláusula única.",
        "____ linha repetida ____",
        "8.3. Terceira cláusula única.",
        "____ linha repetida ____",
      ].join("\n")
    );
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        {
          trecho_literal:
            "8.1. Primeira cláusula da garantia.\n8.2. Segunda cláusula única.\n____ linha repetida ____\n8.3. Terceira cláusula única.",
          token: "clausula_garantia",
        },
      ])
    );

    const report = await run("d2");

    expect(report.inserted).toHaveLength(1);
    expect(report.inserted[0].token).toBe("clausula_garantia");
    expect(report.inserted[0].leftoverParagraphs).toEqual(["____ linha repetida ____"]);

    const requests = mockBatchUpdate.mock.calls[0][0].requestBody.requests as ReplaceReq[];
    const byText = Object.fromEntries(
      requests.map((r) => [r.replaceAllText.containsText.text, r.replaceAllText.replaceText])
    );
    expect(byText["8.1. Primeira cláusula da garantia."]).toBe("{{clausula_garantia}}");
    expect(byText["8.2. Segunda cláusula única."]).toBe("");
    expect(byText["8.3. Terceira cláusula única."]).toBe("");
    expect(byText["____ linha repetida ____"]).toBeUndefined();
  });

  it("multi-parágrafo com 1º parágrafo ambíguo: skip inteiro", async () => {
    useDoc("Linha dupla.\nLinha dupla.\nResto único.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "Linha dupla.\nResto único.", token: "clausula_garantia" }])
    );

    const report = await run("d3");

    expect(report.inserted).toHaveLength(0);
    expect(report.skippedAmbiguous[0]).toEqual(
      expect.objectContaining({ token: "clausula_garantia", reason: "ambiguous" })
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  // ——— Trecho já tokenizado é intocável ———

  it("REGRESSÃO (Trio): não reescreve o trecho que contém {{slot_garantia}}", async () => {
    useDoc("CLÁUSULA OITAVA - DA GARANTIA\n{{slot_garantia}}\nCLÁUSULA NONA - DO FORO");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "{{slot_garantia}}", token: "clausula_garantia" }])
    );

    const report = await run("d4");

    expect(report.inserted).toHaveLength(0);
    expect(report.skippedAmbiguous[0]).toEqual(
      expect.objectContaining({ token: "clausula_garantia", reason: "already-tokenized" })
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("bloco multi-parágrafo que ENGLOBA um token é descartado inteiro", async () => {
    useDoc(
      "CLÁUSULA OITAVA - DA GARANTIA\nA garantia é a seguinte:\n{{slot_garantia}}\nParágrafo final da cláusula."
    );
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        {
          trecho_literal:
            "A garantia é a seguinte:\n{{slot_garantia}}\nParágrafo final da cláusula.",
          token: "clausula_garantia",
        },
      ])
    );

    const report = await run("d5");

    expect(report.skippedAmbiguous[0].reason).toBe("already-tokenized");
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("mapeamento legítimo segue passando quando o doc tem outros tokens", async () => {
    useDoc("{{slot_garantia}}\nO valor do aluguel é de R$ 3.500,00 mensais, reajustado anualmente.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "R$ 3.500,00", token: "aluguel_valor" }])
    );

    const report = await run("d6");

    expect(report.inserted).toEqual([expect.objectContaining({ token: "aluguel_valor" })]);
    expect(mockBatchUpdate).toHaveBeenCalled();
  });
});

/**
 * Reingestão da RE/MAX Trio (2026-09-02): 11 dos 12 modelos do lote 1 tinham
 * token em `inserted` que NÃO estava no documento. O passe montava a lista
 * antes do batch e descartava a resposta. Estes testes fixam o contrário:
 * `inserted` é o que o Doc confirma, e cada modo de falha tem nome.
 */
describe("insertPlaceholdersWithAI — inserted só depois de conferir", () => {
  const DOC = "O aluguel mensal é de R$ 2.500,00. Vencimento todo dia 10 (dez).";
  const MAP = aiResponse([
    { trecho_literal: "R$ 2.500,00", token: "aluguel_valor" },
    { trecho_literal: "10 (dez)", token: "aluguel_dia_vencimento" },
  ]);

  it("caminho feliz: os dois confirmados, e notMapped lê o estado PÓS-passe", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    const report = await run();
    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_valor", "aluguel_dia_vencimento"]);
    expect(report.notMapped.map((n) => n.token)).not.toContain("aluguel_valor");
    expect(report.notMapped.map((n) => n.token)).not.toContain("aluguel_dia_vencimento");
    expect(mockGetDocPlainText).toHaveBeenCalledTimes(2);
  });

  it("replace-noop: a API casou 0 ocorrências — o texto plano mentiu", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    // O Docs "não encontra" o 2º trecho (formatação invisível no meio).
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const filtered = {
        requestBody: {
          requests: arg.requestBody.requests.filter(
            (r: ReplaceReq) => r.replaceAllText.containsText.text !== "10 (dez)"
          ),
        },
      };
      const res = await real(filtered);
      // reply do request suprimido: 0 ocorrências, na posição certa
      res.data.replies.splice(1, 0, { replaceAllText: { occurrencesChanged: 0 } });
      return res;
    });

    const report = await run();
    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_valor"]);
    expect(report.skippedAmbiguous).toEqual([
      expect.objectContaining({ token: "aluguel_dia_vencimento", reason: "replace-noop" }),
    ]);
    // O relatório aponta o que falta de verdade.
    expect(report.notMapped.map((n) => n.token)).toContain("aluguel_dia_vencimento");
  });

  it("over-matched: a API casou mais de uma vez (cabeçalho/rodapé) — não é inserido", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real(arg);
      res.data.replies[0] = { replaceAllText: { occurrencesChanged: 2 } };
      return res;
    });

    const report = await run();
    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_dia_vencimento"]);
    expect(report.skippedAmbiguous).toEqual([
      expect.objectContaining({ token: "aluguel_valor", reason: "over-matched" }),
    ]);
    // O token ESTÁ no Doc (a API pôs), mas não onde alguém revisou: não some
    // dos dois lados do relatório — conta como faltante até ser confirmado.
    expect(state).toContain("{{aluguel_valor}}");
    expect(report.notMapped.map((n) => n.token)).toContain("aluguel_valor");
    expect(report.missingRequired).toContain("aluguel_valor");
  });

  it("over-removed: parágrafo do bloco apagado em mais de um lugar — nome do parágrafo e conteúdo perdido declarado", async () => {
    // "Assinatura: ____" é único no corpo (o texto plano não vê o rodapé), mas
    // a API casa 2 — o rodapé perdeu a linha e ninguém revisou aquilo.
    useDoc("8.1. Primeira.\nAssinatura: ____\n8.3. Terceira.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        { trecho_literal: "8.1. Primeira.\nAssinatura: ____\n8.3. Terceira.", token: "clausula_garantia" },
      ])
    );
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real(arg);
      res.data.replies[1] = { replaceAllText: { occurrencesChanged: 2 } };
      return res;
    });

    const report = await run();
    expect(report.inserted).toEqual([]);
    expect(report.skippedAmbiguous).toEqual([
      expect.objectContaining({
        token: "clausula_garantia",
        reason: "over-removed",
        paragraph: "Assinatura: ____",
      }),
    ]);
    // O Doc mudou de verdade (token entrou, parágrafos saíram) e o relatório
    // NÃO finge que está tudo bem: o token segue como não mapeado.
    expect(state).toContain("{{clausula_garantia}}");
    expect(report.notMapped.map((n) => n.token)).toContain("clausula_garantia");
  });

  it("notMapped traz o MOTIVO por token: o do passe quando a IA tentou, no-mapping quando não", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        { trecho_literal: "R$ 2.500,00", token: "aluguel_valor" },
        { trecho_literal: "texto que não existe", token: "aluguel_dia_vencimento" },
      ])
    );
    const report = await run();
    const by = Object.fromEntries(report.notMapped.map((n) => [n.token, n]));
    expect(by.aluguel_valor).toBeUndefined(); // confirmado
    expect(by.aluguel_dia_vencimento).toEqual({
      token: "aluguel_dia_vencimento",
      reason: "not-found",
      trecho: "texto que não existe",
    });
    expect(by.imovel_identificacao).toEqual({ token: "imovel_identificacao", reason: "no-mapping" });
  });

  it("PII do contrato-fonte NÃO entra no relatório: trecho e parágrafo saem mascarados", async () => {
    // CPF canônico de teste + agência/conta sintéticas — o relatório vai para
    // o jsonb e para a tela; o dado real fica só no Doc.
    useDoc(
      "Ana, CPF 529.982.247-25, conta na Agência 1234 Conta 68233198-6.\nAna, CPF 529.982.247-25, de novo."
    );
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "Ana, CPF 529.982.247-25", token: "locadores_qualificacao" }])
    );
    const report = await run();
    expect(report.skippedAmbiguous[0].reason).toBe("ambiguous");
    expect(report.skippedAmbiguous[0].trecho).not.toContain("529.982.247-25");
    expect(report.skippedAmbiguous[0].trecho).toContain("000.000.000-00");
    const nm = report.notMapped.find((n) => n.token === "locadores_qualificacao")!;
    expect(nm.reason).toBe("ambiguous");
    expect(nm.trecho).not.toContain("529.982.247-25");
    // Controle: o mesmo texto sem máscara conteria o CPF.
    expect(JSON.stringify(report)).not.toContain("529.982.247-25");
  });

  it("PII também sai mascarada de `inserted` — depois do replace, o trecho só existe no relatório", async () => {
    useDoc("LOCADORA: Ana Ribeiro, CPF 529.982.247-25, Agência 1234 Conta 68233198-6.\nCLÁUSULA 1.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([
        {
          trecho_literal: "Ana Ribeiro, CPF 529.982.247-25, Agência 1234 Conta 68233198-6.",
          token: "locadores_qualificacao",
        },
      ])
    );
    const report = await run();
    expect(report.inserted.map((i) => i.token)).toEqual(["locadores_qualificacao"]);
    expect(state).toContain("{{locadores_qualificacao}}");
    expect(state).not.toContain("529.982.247-25"); // o Doc já não tem
    expect(report.inserted[0].trecho).toContain("000.000.000-00");
    // Asserção de AUSÊNCIA: nenhum CPF sobrevive em lugar nenhum do relatório
    // (o placeholder da máscara tem a mesma forma — sai antes da busca).
    expect(JSON.stringify(report).replace(/000\.000\.000-00/g, "")).not.toMatch(
      /\d{3}\.\d{3}\.\d{3}-\d{2}/
    );
    expect(JSON.stringify(report)).not.toContain("529.982.247-25");
    expect(JSON.stringify(report)).not.toContain("68233198-6");
  });

  it("readNotMapped aceita o formato antigo (string[]) e o novo, e descarta lixo", async () => {
    const { readNotMapped } = await import("../ai-placeholder-insertion");
    expect(readNotMapped(["a", "b"])).toEqual([
      { token: "a", reason: "no-mapping" },
      { token: "b", reason: "no-mapping" },
    ]);
    expect(readNotMapped([{ token: "a", reason: "ambiguous", trecho: "x" }, { nope: 1 }, 7, null])).toEqual([
      { token: "a", reason: "ambiguous", trecho: "x" },
    ]);
    expect(readNotMapped(undefined)).toEqual([]);
    expect(readNotMapped("x")).toEqual([]);
  });

  it("documento maior que o teto: a cauda fica fora e o relatório DIZ isso (docTruncated + doc-truncated)", async () => {
    const { MAX_PROMPT_CHARS } = await import("../ai-placeholder-insertion");
    // Cabeça com o aluguel; cauda (além do teto) com o vencimento.
    const head = "O aluguel mensal é de R$ 2.500,00. ";
    // Filler garantidamente maior que o teto (a frase tem 43 chars).
    const filler = "Cláusula padrão que não varia por negócio. ".repeat(
      Math.ceil(MAX_PROMPT_CHARS / 40)
    );
    expect((head + filler).length).toBeGreaterThan(MAX_PROMPT_CHARS);
    const tail = "\nVencimento todo dia 17 (dezessete).";
    useDoc(head + filler + tail);
    mockMessagesCreate.mockImplementation(async (arg: { messages: Array<{ content: string }> }) => {
      // O prompt NÃO pode carregar a cauda.
      expect(arg.messages[0].content).not.toContain("17 (dezessete)");
      return aiResponse([{ trecho_literal: "R$ 2.500,00", token: "aluguel_valor" }]);
    });

    const report = await run();
    expect(report.docTruncated).toBe(true);
    expect(report.responseTruncated).toBe(false);
    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_valor"]);
    const venc = report.notMapped.find((n) => n.token === "aluguel_dia_vencimento")!;
    expect(venc.reason).toBe("doc-truncated");
  });

  it("resposta cortada em max_tokens: responseTruncated, e não uma lista vazia muda", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 8192 },
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"mapeamentos":[{"trecho_literal":"R$ 2.500,00","token":"aluguel_valor"},{"trecho_lit' }],
    });
    const report = await run();
    expect(report.responseTruncated).toBe(true);
    expect(report.inserted).toEqual([]);
    expect(report.notMapped.find((n) => n.token === "aluguel_valor")!.reason).toBe("response-truncated");
  });

  it("doc E resposta truncados: o doc vence no motivo por token — rodar de novo não muda o corte", async () => {
    const { MAX_PROMPT_CHARS } = await import("../ai-placeholder-insertion");
    const head = "O aluguel mensal é de R$ 2.500,00. ";
    const filler = "Cláusula padrão que não varia por negócio. ".repeat(Math.ceil(MAX_PROMPT_CHARS / 40));
    useDoc(head + filler + "\nVencimento todo dia 17 (dezessete).");
    mockMessagesCreate.mockResolvedValue({
      usage: { input_tokens: 35000, output_tokens: 8192 },
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"mapeamentos":[{"trecho_literal":"R$ 2.500,00","token":"aluguel_valor"},{"tre' }],
    });
    const report = await run();
    expect(report.docTruncated).toBe(true);
    expect(report.responseTruncated).toBe(true);
    for (const n of report.notMapped) expect(n.reason).toBe("doc-truncated");
  });

  it("documento dentro do teto e resposta inteira: flags PRESENTES e falsas (o merge raso do rerun precisa delas)", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue({ ...MAP, stop_reason: "end_turn" });
    const report = await run();
    // `false`, não `undefined`: `rerun-ai` faz `{...antigo, ...novo}` — chave
    // ausente deixaria um `true` de passada anterior grudado para sempre.
    expect(report.docTruncated).toBe(false);
    expect(report.responseTruncated).toBe(false);
    expect({ docTruncated: true, responseTruncated: true, ...report }).toMatchObject({
      docTruncated: false,
      responseTruncated: false,
    });
    expect(mockMessagesCreate.mock.calls[0][0].max_tokens).toBe(8192);
  });

  it("reply ausente num parágrafo do bloco: a releitura decide se virou leftover", async () => {
    useDoc("8.1. Primeira.\n8.2. Segunda.\n8.3. Terceira.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "8.1. Primeira.\n8.2. Segunda.\n8.3. Terceira.", token: "clausula_garantia" }])
    );
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      // O Docs "não executa" o request de 8.2 e a lista de replies vem curta.
      const res = await real({
        requestBody: {
          requests: arg.requestBody.requests.filter(
            (r: ReplaceReq) => r.replaceAllText.containsText.text !== "8.2. Segunda."
          ),
        },
      });
      res.data.replies = res.data.replies.slice(0, 1);
      return res;
    });

    const report = await run();
    expect(report.inserted).toHaveLength(1);
    expect(report.inserted[0].leftoverParagraphs).toEqual(["8.2. Segunda."]);
    expect(state).toContain("8.2. Segunda.");
  });

  it("verify-failed: a API disse que trocou, mas a releitura não mostra o token", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    // Batch responde 1 ocorrência para tudo mas NÃO muta o estado.
    mockBatchUpdate.mockImplementation(async (arg: { requestBody: { requests: ReplaceReq[] } }) => ({
      data: {
        replies: arg.requestBody.requests.map(() => ({ replaceAllText: { occurrencesChanged: 1 } })),
      },
    }));

    const report = await run();
    expect(report.inserted).toEqual([]);
    expect(report.skippedAmbiguous.map((s) => s.reason)).toEqual(["verify-failed", "verify-failed"]);
    expect(report.notMapped.map((n) => n.token)).toContain("aluguel_valor");
  });

  it("verify-unavailable: releitura falhou — 'não sei' não vira 'deu certo'", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    mockGetDocPlainText
      .mockResolvedValueOnce(DOC)
      .mockRejectedValueOnce(new Error("Drive 503"));

    const report = await run();
    expect(report.inserted).toEqual([]);
    expect(report.skippedAmbiguous.map((s) => s.reason)).toEqual([
      "verify-unavailable",
      "verify-unavailable",
    ]);
    // Pessimista: sem releitura, notMapped é o pré-passe.
    expect(report.notMapped.map((n) => n.token)).toContain("aluguel_valor");
  });

  it("batch-failed: o Google recusou o lote — nada inserido, nenhuma releitura", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    mockBatchUpdate.mockRejectedValue(new Error("400 Invalid requests"));

    const report = await run();
    expect(report.inserted).toEqual([]);
    expect(report.skippedAmbiguous.map((s) => s.reason)).toEqual(["batch-failed", "batch-failed"]);
    expect(mockGetDocPlainText).toHaveBeenCalledTimes(1);
  });

  it("reply ausente (lista curta) não decide: a releitura confirma", async () => {
    useDoc(DOC);
    mockMessagesCreate.mockResolvedValue(MAP);
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real(arg);
      res.data.replies = [];
      return res;
    });

    const report = await run();
    expect(report.inserted.map((i) => i.token)).toEqual(["aluguel_valor", "aluguel_dia_vencimento"]);
  });

  it("bloco: parágrafo do meio que a API não casou vai para leftoverParagraphs", async () => {
    useDoc("8.1. Primeira.\n8.2. Segunda.\n8.3. Terceira.");
    mockMessagesCreate.mockResolvedValue(
      aiResponse([{ trecho_literal: "8.1. Primeira.\n8.2. Segunda.\n8.3. Terceira.", token: "clausula_garantia" }])
    );
    const real = mockBatchUpdate.getMockImplementation()!;
    mockBatchUpdate.mockImplementation(async (arg) => {
      const res = await real({
        requestBody: {
          requests: arg.requestBody.requests.filter(
            (r: ReplaceReq) => r.replaceAllText.containsText.text !== "8.2. Segunda."
          ),
        },
      });
      res.data.replies.splice(1, 0, { replaceAllText: { occurrencesChanged: 0 } });
      return res;
    });

    const report = await run();
    expect(report.inserted).toHaveLength(1);
    expect(report.inserted[0].leftoverParagraphs).toEqual(["8.2. Segunda."]);
    expect(state).toContain("8.2. Segunda.");
  });
});
