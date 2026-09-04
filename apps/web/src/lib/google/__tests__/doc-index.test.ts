import { describe, it, expect } from "vitest";
import { findBlockRange, findParagraphRange } from "../doc-index";

/**
 * Doc simulado: um `textRun` por parágrafo, índices como a API devolve. `""`
 * é um parágrafo vazio (o export do Drive intercala vários entre as linhas do
 * bloco de assinaturas); `"[[TABELA]]"` é um bloco que não é parágrafo.
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

describe("findBlockRange — a sequência identifica o bloco, não cada parágrafo", () => {
  it("bloco consecutivo: do início do primeiro ao fim do último", () => {
    const doc = fakeDoc(["Cabeçalho", "a) item", "b) item", "Rodapé"]);
    const r = findBlockRange(doc, ["a) item", "b) item"]);
    // "Cabeçalho\n" ocupa 1..10; "a) item" começa em 11.
    expect(r).toEqual({ startIndex: 11, endIndex: 11 + 7 + 1 + 7 });
  });

  it("parágrafos VAZIOS dentro do bloco entram no intervalo", () => {
    const doc = fakeDoc(["____", "", "", "PARTE LOCADORA", "", "____", "Testemunha", "Fim"]);
    const r = findBlockRange(doc, ["____", "PARTE LOCADORA", "____", "Testemunha"]);
    expect(r).not.toBeNull();
    // Termina no fim de "Testemunha" (sem a marca de parágrafo), antes de "Fim".
    const texto = ["____", "", "", "PARTE LOCADORA", "", "____", "Testemunha"].map((p) => `${p}\n`).join("");
    expect(r!.startIndex).toBe(1);
    expect(r!.endIndex).toBe(1 + texto.length - 1);
  });

  it("parágrafo repetido no documento não confunde: só a sequência inteira casa", () => {
    const doc = fakeDoc(["____", "PARTE LOCATÁRIA", "", "____", "PARTE LOCADORA", "PARTE LOCATÁRIA"]);
    const r = findBlockRange(doc, ["____", "PARTE LOCADORA"]);
    expect(r).not.toBeNull();
    // A sequência começa no SEGUNDO "____".
    expect(r!.startIndex).toBe(1 + 5 + 16 + 1);
  });

  it("texto diferente no meio do bloco recusa", () => {
    const doc = fakeDoc(["a) item", "cláusula no meio", "b) item"]);
    expect(findBlockRange(doc, ["a) item", "b) item"])).toBeNull();
  });

  it("tabela entre os parágrafos recusa — o intervalo a apagaria", () => {
    const doc = fakeDoc(["a) item", "[[TABELA]]", "b) item"]);
    expect(findBlockRange(doc, ["a) item", "b) item"])).toBeNull();
  });

  it("a mesma sequência duas vezes é ambígua", () => {
    const doc = fakeDoc(["____", "Nome", "x", "____", "Nome"]);
    expect(findBlockRange(doc, ["____", "Nome"])).toBeNull();
  });

  it("um parágrafo só: exige unicidade como findParagraphRange", () => {
    const doc = fakeDoc(["Único.", "Outro.", "Único."]);
    expect(findBlockRange(doc, ["Único."])).toBeNull();
    expect(findParagraphRange(doc, "Único.")).toBeNull();
    expect(findBlockRange(doc, ["Outro."])).toEqual(findParagraphRange(doc, "Outro."));
  });
});
