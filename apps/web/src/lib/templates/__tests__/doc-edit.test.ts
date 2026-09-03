import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * O aplicador de edições é o único caminho pelo qual o app escreve num
 * Doc-modelo fora do passe de IA. Como `replaceAllText` troca TODAS as
 * ocorrências, cada caso aqui existe para provar uma recusa: o que NÃO é
 * enviado importa mais do que o que é.
 */
const getDocPlainTextMock = vi.fn();
const getDocStructureMock = vi.fn();
const batchUpdateDocMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...a: unknown[]) => getDocPlainTextMock(...a),
  getDocStructure: (...a: unknown[]) => getDocStructureMock(...a),
  batchUpdateDoc: (...a: unknown[]) => batchUpdateDocMock(...a),
}));

import { applyDocEdits, type DocEditOp } from "../doc-edit";

/**
 * Doc simulado. Um `textRun` por parágrafo, com índices como a API devolve.
 *
 * `"[[TABELA]]"` na lista vira um bloco que NÃO é parágrafo (uma tabela) — o
 * `body.content` real também guarda tabela, quebra de seção e sumário, e é
 * justamente esse tipo de bloco que o localizador precisa enxergar para não
 * apagá-lo junto ao atravessá-lo.
 */
function fakeDoc(paragrafos: string[]) {
  let index = 1;
  return {
    body: {
      content: paragrafos.map((p) => {
        if (p === "[[TABELA]]") {
          const bloco = { startIndex: index, endIndex: index + 10, table: { rows: 1, columns: 1 } };
          index += 10;
          return bloco;
        }
        const texto = `${p}\n`;
        const el = { startIndex: index, endIndex: index + texto.length, textRun: { content: texto } };
        index += texto.length;
        return { paragraph: { elements: [el] } };
      }),
    },
  };
}

/** Resposta do batch com N replies de 1 ocorrência trocada. */
const replies = (n: number, changed = 1) => ({
  data: { replies: Array.from({ length: n }, () => ({ replaceAllText: { occurrencesChanged: changed } })) },
});

const run = (ops: DocEditOp[], modalidade = "locacao") =>
  applyDocEdits({ docId: "doc1", modalidade, ops });

beforeEach(() => {
  vi.clearAllMocks();
  batchUpdateDocMock.mockResolvedValue(replies(1));
});

describe("rekey — trocar a chave da parte errada", () => {
  const frase =
    "a) pago à imobiliária intermediadora {{corretagem_qualificacao}}, como honorários;";

  it("troca a chave preservando o resto da frase", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce(frase)
      .mockResolvedValueOnce(frase.replace("corretagem_qualificacao", "imobiliaria_qualificacao"));

    const out = await run([
      {
        op: "rekey",
        phrase: frase,
        fromToken: "corretagem_qualificacao",
        toToken: "imobiliaria_qualificacao",
      },
    ]);

    expect(out.results[0]).toMatchObject({ op: "rekey", status: "applied" });
    const req = batchUpdateDocMock.mock.calls[0][1][0].replaceAllText;
    expect(req.containsText.text).toBe(frase);
    expect(req.replaceText).toContain("{{imobiliaria_qualificacao}}");
    expect(req.replaceText).toContain("como honorários");
  });

  it("frase sem a chave de origem é recusada ANTES de escrever", async () => {
    getDocPlainTextMock.mockResolvedValue("a) pago à imobiliária intermediadora Trio Ltda;");
    const out = await run([
      {
        op: "rekey",
        phrase: "a) pago à imobiliária intermediadora Trio Ltda;",
        fromToken: "corretagem_qualificacao",
        toToken: "imobiliaria_qualificacao",
      },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "token-missing-in-phrase" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("chave de destino fora do catálogo da modalidade é recusada", async () => {
    getDocPlainTextMock.mockResolvedValue(frase);
    const out = await run(
      [
        {
          op: "rekey",
          phrase: frase,
          fromToken: "corretagem_qualificacao",
          toToken: "imobiliaria_qualificacao",
        },
      ],
      "a_vista" // venda não tem `imobiliaria_*`
    );
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "unknown-token" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("mesma chave de origem e destino não vira edição", async () => {
    getDocPlainTextMock.mockResolvedValue(frase);
    const out = await run([
      {
        op: "rekey",
        phrase: frase,
        fromToken: "corretagem_qualificacao",
        toToken: "corretagem_qualificacao",
      },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "same-token" });
  });
});

describe("remove-leftover — apagar o dado do titular ao lado da chave", () => {
  const doc = "b) pago a {{corretagem_qualificacao}}, CRECI 12345-F, conforme ajustado.";

  it("remove a frase e confere a ausência dela", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(doc.replace(", CRECI 12345-F", ""));
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "applied" });
    expect(batchUpdateDocMock.mock.calls[0][1][0].replaceAllText.replaceText).toBe("");
  });

  it("frase que carrega chave é recusada — removê-la apagaria o campo", async () => {
    getDocPlainTextMock.mockResolvedValue(doc);
    const out = await run([
      { op: "remove-leftover", phrase: "{{corretagem_qualificacao}}, CRECI 12345-F" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "phrase-has-token" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("trecho ambíguo não é enviado", async () => {
    getDocPlainTextMock.mockResolvedValue("CRECI 12345-F\noutra linha\nCRECI 12345-F");
    const out = await run([{ op: "remove-leftover", phrase: "CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "ambiguous" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });
});

describe("map-field — trecho literal vira chave", () => {
  it("aplica e confere", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce("LOCADOR: João da Silva, brasileiro.")
      .mockResolvedValueOnce("LOCADOR: {{locadores_qualificacao}}.");
    const out = await run([
      { op: "map-field", phrase: "João da Silva, brasileiro", token: "locadores_qualificacao" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "applied" });
  });

  it("trecho que já tem chave é recusado", async () => {
    getDocPlainTextMock.mockResolvedValue("já tem {{aluguel_valor}} aqui");
    const out = await run([
      { op: "map-field", phrase: "já tem {{aluguel_valor}} aqui", token: "aluguel_valor" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "phrase-has-token" });
  });
});

describe("restore-paragraph — devolver a cláusula que a chave engoliu", () => {
  const colapsado = "{{imobiliaria_qualificacao}}";
  const original = [
    "a) R$ 2.500,00, a ser pago diretamente à imobiliária intermediadora Trio Ltda;",
    "b) R$ 1.500,00, a ser pago diretamente ao(à) corretor(a) Ana Ribeiro.",
  ].join("\n");

  it("apaga o intervalo e insere o texto, em batch SEPARADO e com a estrutura relida", async () => {
    const antes = ["4.1.1. O pagamento será rateado assim:", colapsado, "4.1.2. Retido no repasse."];
    getDocPlainTextMock
      .mockResolvedValueOnce(antes.join("\n"))
      .mockResolvedValueOnce([antes[0], original, antes[2]].join("\n"));
    getDocStructureMock.mockResolvedValue(fakeDoc(antes));

    const out = await run([{ op: "restore-paragraph", current: colapsado, source: original }]);

    expect(out.results[0]).toMatchObject({ op: "restore-paragraph", status: "applied" });
    // Nenhum request de texto: a restauração é estrutural.
    expect(batchUpdateDocMock).toHaveBeenCalledTimes(1);
    const reqs = batchUpdateDocMock.mock.calls[0][1];
    expect(reqs[0].deleteContentRange.range).toEqual({
      startIndex: 1 + antes[0].length + 1,
      endIndex: 1 + antes[0].length + 1 + colapsado.length,
    });
    expect(reqs[1].insertText.text).toBe(original);
    // A estrutura é lida DEPOIS do texto, não reaproveitada de antes.
    expect(getDocStructureMock).toHaveBeenCalledTimes(1);
  });

  it("parágrafo repetido no documento não é restaurado", async () => {
    const antes = ["abre:", colapsado, "meio", colapsado];
    getDocPlainTextMock.mockResolvedValue(antes.join("\n"));
    const out = await run([{ op: "restore-paragraph", current: colapsado, source: original }]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "ambiguous" });
    expect(getDocStructureMock).not.toHaveBeenCalled();
  });

  it("estrutura sem o parágrafo falha em vez de apagar o intervalo errado", async () => {
    getDocPlainTextMock.mockResolvedValue(["abre:", colapsado].join("\n"));
    getDocStructureMock.mockResolvedValue(fakeDoc(["abre:", "outra coisa"]));
    const out = await run([{ op: "restore-paragraph", current: colapsado, source: original }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "structure-not-found" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("fonte vazia não vira edição", async () => {
    getDocPlainTextMock.mockResolvedValue(colapsado);
    const out = await run([{ op: "restore-paragraph", current: colapsado, source: "   " }]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "empty-source" });
  });
});

describe("replace-block — a migração que não tinha caminho", () => {
  // O caso real dos 16 modelos da Trio: a lista de rateio chaveada item a item.
  // Cada chave de corretagem imprime a lista INTEIRA de beneficiários, então um
  // item sai com nome sem conta e o outro com conta sem nome. A chave certa
  // existe desde o #554 e NADA conseguia aplicá-la — `map-field` e o passe de IA
  // recusam trecho que já tem chave, e a trava dos dois está certa.
  const cabecalho = "4.1.1. O pagamento correspondente ao primeiro aluguel será rateado assim:";
  const itens = [
    "a) R$0000 (três mil...), a ser pago à imobiliária intermediadora {{imobiliaria_qualificacao}};",
    "b) R$ 1.315,15, a ser pago à corretora intermediadora {{corretagem_dados_pagamento}}",
    "c) R$ 1.315,15, a ser pago ao corretor intermediador {{corretagem_qualificacao}}.",
  ];
  const depois = "4.1.2. A comprovação do pagamento servirá como quitação.";
  const doc = [cabecalho, ...itens, depois];

  it("troca o bloco inteiro por UMA chave, preservando o cabeçalho", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce(doc.join("\n"))
      .mockResolvedValueOnce([cabecalho, "{{rateio_primeiro_aluguel}}", depois].join("\n"));
    getDocStructureMock.mockResolvedValue(fakeDoc(doc));

    const out = await run([
      { op: "replace-block", paragraphs: itens, token: "rateio_primeiro_aluguel" },
    ]);

    expect(out.results[0]).toMatchObject({ op: "replace-block", status: "applied" });
    const reqs = batchUpdateDocMock.mock.calls[0][1];
    // O intervalo vai do início do item a) ao fim do item c) — nem antes nem depois.
    const inicioA = 1 + cabecalho.length + 1;
    expect(reqs[0].deleteContentRange.range.startIndex).toBe(inicioA);
    expect(reqs[1].insertText.text).toBe("{{rateio_primeiro_aluguel}}");
  });

  it("bloco NÃO consecutivo é recusado antes de qualquer escrita", async () => {
    // Apagar do primeiro ao último engoliria o que está no meio — e o que está
    // no meio é contrato.
    getDocPlainTextMock.mockResolvedValue(doc.join("\n"));
    const out = await run([
      {
        op: "replace-block",
        paragraphs: [itens[0]!, itens[2]!], // pula o b)
        token: "rateio_primeiro_aluguel",
      },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "block-not-consecutive" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("parágrafo repetido no documento é recusado", async () => {
    getDocPlainTextMock.mockResolvedValue([...doc, itens[0]!].join("\n"));
    const out = await run([
      { op: "replace-block", paragraphs: [itens[0]!], token: "rateio_primeiro_aluguel" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "ambiguous" });
  });

  it("chave fora do catálogo da modalidade é recusada", async () => {
    getDocPlainTextMock.mockResolvedValue(doc.join("\n"));
    const out = await run(
      [{ op: "replace-block", paragraphs: itens, token: "rateio_primeiro_aluguel" }],
      "a_vista"
    );
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "unknown-token" });
  });

  it("TABELA entre os parágrafos: recusa em vez de apagá-la junto", async () => {
    // O caso mais perigoso desta operação. Uma tabela entre dois itens não é
    // parágrafo: sai da lista filtrada e os dois PARECEM vizinhos — mas ela
    // ocupa índices, e o intervalo "do primeiro ao último" a levaria embora.
    // Como a conferência só verifica que os parágrafos PRETENDIDOS sumiram, e
    // nunca que nada além deles sumiu, o estrago sairia como sucesso.
    const comTabela = [cabecalho, itens[0]!, "[[TABELA]]", itens[1]!, depois];
    // No texto plano a tabela não aparece, então os dois itens parecem coladas —
    // é exatamente por isso que a prova no texto não basta.
    getDocPlainTextMock.mockResolvedValue(
      [cabecalho, itens[0]!, itens[1]!, depois].join("\n")
    );
    getDocStructureMock.mockResolvedValue(fakeDoc(comTabela));

    const out = await run([
      { op: "replace-block", paragraphs: [itens[0]!, itens[1]!], token: "rateio_primeiro_aluguel" },
    ]);

    expect(out.results[0]).toMatchObject({ status: "failed", reason: "structure-not-found" });
    // Nada foi enviado: a recusa acontece antes do batch.
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });

  it("releitura indisponível reporta a operação CERTA, não restore-paragraph", async () => {
    // O rótulo errado não corrompe o Doc, mas corrompe o log de auditoria — que
    // é o único lugar onde fica registrado o que foi feito no texto contratual.
    getDocPlainTextMock
      .mockResolvedValueOnce(doc.join("\n"))
      .mockRejectedValueOnce(new Error("Drive fora"));
    getDocStructureMock.mockResolvedValue(fakeDoc(doc));

    const out = await run([
      { op: "replace-block", paragraphs: itens, token: "rateio_primeiro_aluguel" },
    ]);

    expect(out.results[0]).toMatchObject({
      op: "replace-block",
      status: "failed",
      reason: "verify-unavailable",
    });
  });

  it("sobrevivente do bloco na releitura é falha, não sucesso", async () => {
    // Se um parágrafo continua lá, o intervalo apagado não era o que se pensava.
    getDocPlainTextMock
      .mockResolvedValueOnce(doc.join("\n"))
      .mockResolvedValueOnce([cabecalho, "{{rateio_primeiro_aluguel}}", itens[2]!, depois].join("\n"));
    getDocStructureMock.mockResolvedValue(fakeDoc(doc));
    const out = await run([
      { op: "replace-block", paragraphs: itens, token: "rateio_primeiro_aluguel" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "verify-failed" });
  });
});

describe("o documento é quem decide", () => {
  it("lote recusado pelo Google: nada é declarado aplicado", async () => {
    getDocPlainTextMock.mockResolvedValue("b) pago a X, CRECI 12345-F.");
    batchUpdateDocMock.mockRejectedValue(new Error("500"));
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "batch-failed" });
  });

  it("API diz que trocou 0 vezes: falha, não sucesso", async () => {
    getDocPlainTextMock.mockResolvedValue("b) pago a X, CRECI 12345-F.");
    batchUpdateDocMock.mockResolvedValue(replies(1, 0));
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "replace-noop" });
  });

  it("API diz que trocou em mais de um lugar: falha (cabeçalho/rodapé)", async () => {
    getDocPlainTextMock.mockResolvedValue("b) pago a X, CRECI 12345-F.");
    batchUpdateDocMock.mockResolvedValue(replies(1, 2));
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "over-matched" });
  });

  it("releitura indisponível NUNCA vira 'deu certo'", async () => {
    getDocPlainTextMock
      .mockResolvedValueOnce("b) pago a X, CRECI 12345-F.")
      .mockRejectedValueOnce(new Error("Drive fora"));
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "verify-unavailable" });
    expect(out.finalText).toBeNull();
  });

  it("releitura mostra o trecho ainda lá: verify-failed", async () => {
    const doc = "b) pago a X, CRECI 12345-F.";
    getDocPlainTextMock.mockResolvedValueOnce(doc).mockResolvedValueOnce(doc);
    const out = await run([{ op: "remove-leftover", phrase: ", CRECI 12345-F" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "verify-failed" });
  });

  it("documento ilegível: nada é tentado", async () => {
    getDocPlainTextMock.mockRejectedValue(new Error("invalid_grant"));
    const out = await run([{ op: "remove-leftover", phrase: "x" }]);
    expect(out.results[0]).toMatchObject({ status: "failed", reason: "verify-unavailable" });
    expect(batchUpdateDocMock).not.toHaveBeenCalled();
  });
});

describe("várias edições numa chamada", () => {
  it("a unicidade da segunda é contada no texto SIMULADO, não no original", async () => {
    // Depois de trocar a chave do 1º item, o texto muda — a 2ª edição tem que
    // ser avaliada contra o resultado, senão duas trocas sobrepostas passam e a
    // segunda casa zero no Docs.
    const doc = "a) {{corretagem_qualificacao}} aqui;\nb) outra coisa, CRECI 12345-F.";
    getDocPlainTextMock
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(
        "a) {{imobiliaria_qualificacao}} aqui;\nb) outra coisa."
      );
    batchUpdateDocMock.mockResolvedValue(replies(2));

    const out = await run([
      {
        op: "rekey",
        phrase: "a) {{corretagem_qualificacao}} aqui;",
        fromToken: "corretagem_qualificacao",
        toToken: "imobiliaria_qualificacao",
      },
      { op: "remove-leftover", phrase: ", CRECI 12345-F" },
    ]);

    expect(out.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(batchUpdateDocMock.mock.calls[0][1]).toHaveLength(2);
  });

  it("restaura PRIMEIRO e edita o texto devolvido na mesma chamada", async () => {
    // A ordem importa: enquanto o batch de texto ia antes do estrutural, uma
    // edição sobre o texto restaurado era planejada contra um estado que a
    // execução nunca produzia — o replace casava 0 e saía como `replace-noop`,
    // sem que ninguém entendesse por quê.
    const colapsado = "{{imobiliaria_qualificacao}}";
    const original =
      "a) R$ 2.500,00 à imobiliária intermediadora Trio Ltda, CRECI 79.434-J, pela intermediação;";
    const antes = ["4.1.1. Rateio:", colapsado];
    const depois = [antes[0], original.replace(", CRECI 79.434-J", "")].join("\n");

    getDocPlainTextMock.mockResolvedValueOnce(antes.join("\n")).mockResolvedValueOnce(depois);
    getDocStructureMock.mockResolvedValue(fakeDoc(antes));

    const out = await run([
      { op: "restore-paragraph", current: colapsado, source: original },
      { op: "remove-leftover", phrase: ", CRECI 79.434-J" },
    ]);

    expect(out.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    // Dois batches: o estrutural primeiro, o de texto depois.
    expect(batchUpdateDocMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateDocMock.mock.calls[0][1][0]).toHaveProperty("deleteContentRange");
    expect(batchUpdateDocMock.mock.calls[1][1][0].replaceAllText.containsText.text).toBe(
      ", CRECI 79.434-J"
    );
  });

  it("uma edição recusada não impede as outras", async () => {
    const doc = "a) {{corretagem_qualificacao}} aqui;\nb) X, CRECI 12345-F.";
    getDocPlainTextMock
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce("a) {{corretagem_qualificacao}} aqui;\nb) X.");
    const out = await run([
      { op: "map-field", phrase: "trecho que não existe", token: "aluguel_valor" },
      { op: "remove-leftover", phrase: ", CRECI 12345-F" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "skipped", reason: "not-found" });
    expect(out.results[1]).toMatchObject({ status: "applied" });
  });
});
