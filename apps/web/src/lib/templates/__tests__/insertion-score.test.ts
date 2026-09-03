import { describe, it, expect } from "vitest";
import {
  aggregate,
  placementsIn,
  scoreInsertion,
  type GoldCase,
} from "../eval/insertion-score";

const emptyPlan = { skippedAmbiguous: [] };

function gold(over: Partial<GoldCase> = {}): GoldCase {
  return {
    file: "caso.txt",
    modalidade: "locacao",
    expected: [{ token: "locadores_qualificacao", paragraphIndex: 1 }],
    ...over,
  };
}

describe("placementsIn", () => {
  it("lê chave por parágrafo, com o índice do divisor compartilhado", () => {
    const texto = ["Título do contrato", "LOCADOR: {{locadores_qualificacao}}", "", "Cláusula 1."].join("\n");
    expect(placementsIn(texto)).toEqual([
      { token: "locadores_qualificacao", paragraphIndex: 1 },
    ]);
  });
});

describe("scoreInsertion", () => {
  it("conta acerto com tolerância de um parágrafo (bloco composto)", () => {
    const texto = ["Título", "x", "{{locadores_qualificacao}}"].join("\n");
    const s = scoreInsertion({ gold: gold(), simulatedText: texto, plan: emptyPlan });
    expect(s.tp).toBe(1);
    expect(s.fn).toBe(0);
    expect(s.recall).toBe(1);
  });

  it("chave no lugar errado é fp E fn, não só fp", () => {
    const texto = ["a", "b", "c", "d", "e", "{{locadores_qualificacao}}"].join("\n");
    const s = scoreInsertion({ gold: gold(), simulatedText: texto, plan: emptyPlan });
    expect(s.tp).toBe(0);
    expect(s.fn).toBe(1);
    expect(s.fp).toBe(1);
    expect(s.precision).toBe(0);
  });

  it("a mesma chave duas vezes no lugar certo conta um acerto e uma sobra", () => {
    // Sem isto, duplicar um bloco composto pontuaria como dois acertos.
    const texto = ["Título", "{{locadores_qualificacao}}", "{{locadores_qualificacao}}"].join("\n");
    const s = scoreInsertion({ gold: gold(), simulatedText: texto, plan: emptyPlan });
    expect(s.tp).toBe(1);
    expect(s.fp).toBe(1);
  });

  it("casa o MÁXIMO possível quando a mesma chave é esperada em duas posições vizinhas", () => {
    // Com tolerância de ±1, as janelas de 3 e 5 se sobrepõem em 4. O casamento
    // guloso pegaria o observado 4 para o esperado 3 e deixaria o esperado 5
    // sem par, reportando 1 tp / 1 fn / 1 fp onde existe atribuição 1:1
    // perfeita. O erro seria pessimista — mas o módulo existe para o número
    // não mentir em nenhuma direção.
    const g = gold({
      expected: [
        { token: "assinaturas", paragraphIndex: 3 },
        { token: "assinaturas", paragraphIndex: 5 },
      ],
    });
    const texto = ["a", "b", "c", "d", "{{assinaturas}}", "{{assinaturas}}"].join("\n");
    const s = scoreInsertion({ gold: g, simulatedText: texto, plan: emptyPlan });
    expect(s).toMatchObject({ tp: 2, fn: 0, fp: 0 });
  });

  it("o resultado não depende da ordem em que o gabarito foi escrito", () => {
    const texto = ["a", "b", "c", "d", "{{assinaturas}}", "{{assinaturas}}"].join("\n");
    const direta = scoreInsertion({
      gold: gold({
        expected: [
          { token: "assinaturas", paragraphIndex: 3 },
          { token: "assinaturas", paragraphIndex: 5 },
        ],
      }),
      simulatedText: texto,
      plan: emptyPlan,
    });
    const invertida = scoreInsertion({
      gold: gold({
        expected: [
          { token: "assinaturas", paragraphIndex: 5 },
          { token: "assinaturas", paragraphIndex: 3 },
        ],
      }),
      simulatedText: texto,
      plan: emptyPlan,
    });
    expect(invertida.tp).toBe(direta.tp);
    expect(invertida.fn).toBe(direta.fn);
  });

  it("chave que faltou é fn", () => {
    const s = scoreInsertion({
      gold: gold(),
      simulatedText: "Título\nLOCADOR: João da Silva",
      plan: emptyPlan,
    });
    expect(s).toMatchObject({ tp: 0, fn: 1, fp: 0, recall: 0, precision: 1 });
  });

  it("colocação proibida é registrada além de contar como fp", () => {
    const g = gold({
      expected: [],
      forbidden: [{ token: "corretagem_qualificacao", paragraphIndex: 2 }],
    });
    const texto = ["a", "b", "item a) {{corretagem_qualificacao}}"].join("\n");
    const s = scoreInsertion({ gold: g, simulatedText: texto, plan: emptyPlan });
    expect(s.forbiddenHits).toEqual([{ token: "corretagem_qualificacao", paragraphIndex: 2 }]);
    expect(s.fp).toBe(1);
  });

  it("agrega motivos de descarte e achados semânticos", () => {
    const s = scoreInsertion({
      gold: gold({ expected: [] }),
      simulatedText: "nada",
      plan: {
        skippedAmbiguous: [
          { token: "a", trecho: "x", reason: "ambiguous" },
          { token: "b", trecho: "y", reason: "ambiguous" },
          { token: "c", trecho: "z", reason: "engulfs-neighbor" },
        ],
      },
      semantic: [
        { category: "wrong-entity" },
        { category: "wrong-entity" },
        { category: "collapsed-paragraph" },
      ] as never,
    });
    expect(s.skipped).toEqual({ ambiguous: 2, "engulfs-neighbor": 1 });
    expect(s.semantic).toEqual({ "wrong-entity": 2, "collapsed-paragraph": 1 });
  });

  it("caso vazio não divide por zero", () => {
    const s = scoreInsertion({
      gold: gold({ expected: [] }),
      simulatedText: "",
      plan: emptyPlan,
    });
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });
});

describe("aggregate", () => {
  it("pondera pelos totais, não pela média das médias", () => {
    const a = scoreInsertion({
      gold: gold({ expected: [{ token: "t", paragraphIndex: 0 }] }),
      simulatedText: "{{t}}",
      plan: emptyPlan,
    });
    const b = scoreInsertion({
      gold: gold({
        expected: [
          { token: "u", paragraphIndex: 0 },
          { token: "v", paragraphIndex: 1 },
          { token: "w", paragraphIndex: 2 },
        ],
      }),
      simulatedText: "{{u}}",
      plan: emptyPlan,
    });
    const agg = aggregate([a, b]);
    expect(agg).toMatchObject({ tp: 2, fn: 2, fp: 0 });
    expect(agg.recall).toBe(0.5); // 2/4 — a média das médias daria 0,666…
  });
});
