import { describe, it, expect } from "vitest";
import { ALIGN_PARAGRAPH_CAP, alignParagraphs, tokensOf } from "../paragraph-align";

/**
 * O alinhamento é o que a aba "Cláusulas" mostra lado a lado. O que estes
 * casos guardam é a leitura que o operador faz: a chave no lugar do dado
 * aparece como `tokenized`, a cláusula colapsada aparece como um `changed`
 * seguido dos parágrafos que sumiram, e espaço/NBSP nunca viram "diferença".
 */
const kinds = (rows: ReturnType<typeof alignParagraphs>["rows"]) => rows.map((r) => r.kind);

describe("alignParagraphs — casamento", () => {
  it("texto idêntico → tudo `same`, na ordem, com os índices batendo", () => {
    const src = ["CLÁUSULA 1", "O prazo é de 30 meses.", "CLÁUSULA 2"];
    const { rows, capped } = alignParagraphs(src, src);
    expect(capped).toBe(false);
    expect(kinds(rows)).toEqual(["same", "same", "same"]);
    expect(rows.map((r) => [r.docIndex, r.srcIndex])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("a chave no lugar do dado casa o fonte por curinga → `tokenized` com as chaves listadas", () => {
    const doc = ["LOCADOR: {{locador_nome}}, CPF {{locador_cpf}}, residente em {{locador_endereco}}."];
    const src = ["LOCADOR: João da Silva, CPF 123.456.789-00, residente em Rua A, 10, Curitiba/PR."];
    const { rows } = alignParagraphs(doc, src);
    expect(rows).toEqual([
      {
        docIndex: 0,
        srcIndex: 0,
        kind: "tokenized",
        tokens: ["locador_nome", "locador_cpf", "locador_endereco"],
      },
    ]);
  });

  it("espaço duplo e NBSP não são diferença (mesma régua do doc-index)", () => {
    const doc = ["O  aluguel mensal é de {{aluguel_valor}} ."];
    const src = ["O aluguel mensal é de R$ 2.500,00 ."];
    expect(kinds(alignParagraphs(doc, src).rows)).toEqual(["tokenized"]);
    expect(kinds(alignParagraphs(["Foro de Curitiba"], ["Foro  de Curitiba"]).rows)).toEqual([
      "same",
    ]);
  });

  it("parágrafo do fonte que sumiu → `missing-in-doc` no lugar em que estava", () => {
    const doc = ["A", "C"];
    const src = ["A", "B", "C"];
    const { rows } = alignParagraphs(doc, src);
    expect(rows).toEqual([
      { docIndex: 0, srcIndex: 0, kind: "same", tokens: [] },
      { docIndex: null, srcIndex: 1, kind: "missing-in-doc", tokens: [] },
      { docIndex: 1, srcIndex: 2, kind: "same", tokens: [] },
    ]);
  });

  it("parágrafo novo no Doc → `added-in-doc`", () => {
    const { rows } = alignParagraphs(["A", "Nota do revisor", "B"], ["A", "B"]);
    expect(kinds(rows)).toEqual(["same", "added-in-doc", "same"]);
    expect(rows[1]).toMatchObject({ docIndex: 1, srcIndex: null });
  });
});

describe("alignParagraphs — o retrato do colapso", () => {
  it("cláusula inteira virou uma chave só: `changed` com o 1º parágrafo e `missing-in-doc` nos demais", () => {
    const doc = [
      "4.1.1. O pagamento do primeiro aluguel será rateado:",
      "{{rateio_primeiro_aluguel}}",
      "4.1.2. Os demais aluguéis são integrais.",
    ];
    const src = [
      "4.1.1. O pagamento do primeiro aluguel será rateado:",
      "a) R$ 1.000,00 à imobiliária intermediadora, via PIX;",
      "b) R$ 800,00 ao corretor Fulano, via conta 123;",
      "c) R$ 700,00 ao corretor Beltrano, via conta 456.",
      "4.1.2. Os demais aluguéis são integrais.",
    ];
    const { rows } = alignParagraphs(doc, src);
    expect(rows).toEqual([
      { docIndex: 0, srcIndex: 0, kind: "same", tokens: [] },
      { docIndex: 1, srcIndex: 1, kind: "changed", tokens: ["rateio_primeiro_aluguel"] },
      { docIndex: null, srcIndex: 2, kind: "missing-in-doc", tokens: [] },
      { docIndex: null, srcIndex: 3, kind: "missing-in-doc", tokens: [] },
      { docIndex: 2, srcIndex: 4, kind: "same", tokens: [] },
    ]);
  });

  it("parágrafo que é SÓ uma chave nunca casa por curinga (casaria qualquer coisa)", () => {
    // Se o curinga valesse aqui, `{{x}}` casaria "Z" e o alinhamento
    // esconderia exatamente o colapso que a aba existe para mostrar.
    const { rows } = alignParagraphs(["{{x}}", "Z"], ["Qualquer parágrafo do contrato.", "Z"]);
    expect(kinds(rows)).toEqual(["changed", "same"]);
  });

  it("literal curto demais ao redor da chave também não casa por curinga", () => {
    const { rows } = alignParagraphs(["a) {{corretagem_qualificacao}};"], ["b) outra coisa bem diferente;"]);
    expect(kinds(rows)).toEqual(["changed"]);
  });

  it("parágrafo repetido no fonte: o LCS escolhe a ocorrência que preserva a ordem", () => {
    const doc = ["Assinam:", "{{assinaturas}}", "Testemunhas:", "Assinam:"];
    const src = ["Assinam:", "João", "Maria", "Testemunhas:", "Assinam:"];
    const { rows } = alignParagraphs(doc, src);
    expect(rows).toEqual([
      { docIndex: 0, srcIndex: 0, kind: "same", tokens: [] },
      { docIndex: 1, srcIndex: 1, kind: "changed", tokens: ["assinaturas"] },
      { docIndex: null, srcIndex: 2, kind: "missing-in-doc", tokens: [] },
      { docIndex: 2, srcIndex: 3, kind: "same", tokens: [] },
      { docIndex: 3, srcIndex: 4, kind: "same", tokens: [] },
    ]);
  });
});

describe("alignParagraphs — correspondência ambígua", () => {
  it("curinga que casa dois parágrafos do fonte marca a linha como `ambiguous`", () => {
    const doc = ["Fiador: {{fiador_nome}}, brasileiro, casado."];
    const src = [
      "Fiador: José Alves, brasileiro, casado.",
      "Fiador: Pedro Lima, brasileiro, casado.",
    ];
    const { rows } = alignParagraphs(doc, src);
    expect(rows[0]).toMatchObject({ kind: "tokenized", srcIndex: 0, ambiguous: true });
    expect(rows[1]).toMatchObject({ kind: "missing-in-doc", srcIndex: 1 });
  });

  it("curinga com um só candidato não é ambíguo", () => {
    const { rows } = alignParagraphs(
      ["Fiador: {{fiador_nome}}, brasileiro, casado."],
      ["Fiador: José Alves, brasileiro, casado.", "Outra cláusula qualquer."]
    );
    expect(rows[0].ambiguous).toBeUndefined();
  });
});

describe("alignParagraphs — bordas", () => {
  it("fonte vazio → tudo `added-in-doc`; Doc vazio → tudo `missing-in-doc`", () => {
    expect(kinds(alignParagraphs(["A", "B"], []).rows)).toEqual(["added-in-doc", "added-in-doc"]);
    expect(kinds(alignParagraphs([], ["A"]).rows)).toEqual(["missing-in-doc"]);
  });

  it("acima do teto pareia por posição e avisa `capped`", () => {
    const big = Array.from({ length: ALIGN_PARAGRAPH_CAP + 1 }, (_, i) => `Parágrafo ${i}`);
    const doc = [...big];
    doc[5] = "Parágrafo 5 editado";
    const { rows, capped } = alignParagraphs(doc, big);
    expect(capped).toBe(true);
    expect(rows).toHaveLength(big.length);
    expect(rows[5]).toMatchObject({ docIndex: 5, srcIndex: 5, kind: "changed" });
    expect(rows[6].kind).toBe("same");
  });

  it("tokensOf lê as chaves com e sem espaço interno", () => {
    expect(tokensOf("{{ a }} e {{b_2}} e {{não}}")).toEqual(["a", "b_2"]);
  });
});
