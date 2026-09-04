import { describe, it, expect } from "vitest";
import { findBlockRange, findForms, findParagraphRange, realFormOf, sameParagraph } from "../doc-index";

/**
 * Doc simulado: um `textRun` por parágrafo, índices como a API devolve. `""`
 * é um parágrafo vazio (o export do Drive intercala vários entre as linhas do
 * bloco de assinaturas); `"[[TABELA]]"` é um bloco que não é parágrafo.
 */
function fakeDoc(paragrafos: Array<string | string[][]>) {
  let index = 1;
  return {
    body: {
      content: paragrafos.map((p) => {
        if (p === "[[TABELA]]") {
          const bloco = { startIndex: index, endIndex: index + 10, table: { rows: 1, columns: 1 } };
          index += 10;
          return bloco;
        }
        if (Array.isArray(p)) {
          // Tabela de uma linha: cada item é uma célula com seus parágrafos.
          const startIndex = index;
          index += 1; // marca de início da tabela
          const tableCells = p.map((cell) => {
            const cellStart = index;
            const content = cell.map((t) => {
              const texto = `${t}\n`;
              const el = { startIndex: index, endIndex: index + texto.length, textRun: { content: texto } };
              index += texto.length;
              return { paragraph: { elements: [el] } };
            });
            return { startIndex: cellStart, endIndex: index, content };
          });
          index += 1; // marca de fim da linha
          return {
            startIndex,
            endIndex: index,
            table: { rows: 1, columns: p.length, tableRows: [{ tableCells }] },
          };
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

describe("findBlockRange — bloco que é uma tabela inteira", () => {
  // O bloco de assinaturas dos modelos da Trio é uma tabela: uma linha de
  // assinatura por célula. O export achata as células em parágrafos, linha a
  // linha; a estrutura só tem a tabela.
  const celulas = [
    ["", "____", "PARTE LOCATÁRIA", ""],
    ["", "____", "PARTE LOCADORA"],
  ];

  it("células na ordem de leitura == bloco → intervalo da tabela inteira", () => {
    const doc = fakeDoc(["Assinam:", celulas, "Fim"]);
    const r = findBlockRange(doc, ["____", "PARTE LOCATÁRIA", "____", "PARTE LOCADORA"]);
    const tabela = doc.body.content[1] as { startIndex: number; endIndex: number };
    expect(r).toEqual({ startIndex: tabela.startIndex, endIndex: tabela.endIndex });
  });

  it("quebra de linha suave (\\u000B) dentro da célula conta como linha, como no export", () => {
    // Produção, 04/09: "CINDY TAVARES COSTA \u000BPARTE LOCATÁRIA" é um parágrafo no
    // Doc e duas linhas no texto exportado — o bloco vem do export.
    const doc = fakeDoc([
      [
        ["", "____", "CINDY TAVARES COSTA \u000BPARTE LOCATÁRIA", ""],
        ["", "____", "PARTE LOCADORA"],
      ],
    ]);
    const r = findBlockRange(doc, ["____", "CINDY TAVARES COSTA", "PARTE LOCATÁRIA", "____", "PARTE LOCADORA"]);
    expect(r).not.toBeNull();
  });

  it("bloco que cobre só PARTE da tabela não casa", () => {
    const doc = fakeDoc(["Assinam:", celulas, "Fim"]);
    expect(findBlockRange(doc, ["____", "PARTE LOCATÁRIA"])).toBeNull();
  });

  it("a mesma tabela duas vezes é ambígua", () => {
    const doc = fakeDoc([celulas, "meio", celulas]);
    expect(findBlockRange(doc, ["____", "PARTE LOCATÁRIA", "____", "PARTE LOCADORA"])).toBeNull();
  });
});

describe("tabulação — o export troca por espaços, a estrutura guarda o \\t", () => {
  // Produção, 04/09: bloco de assinaturas em COLUNAS ("Nome\tNome"), sem
  // tabela. O export mostra "Nome         Nome"; a comparação de parágrafo
  // inteiro tem de ignorar a diferença. `findForms` NÃO (fatia por índice).
  const estrutura = [
    " \t___________________________________________ ",
    "\tXXXXXXXXXXXXXXX \tXXXXXXX ",
    "\tPARTE LOCATÁRIA \tPARTE LOCATÁRIA ",
    "PARTE LOCADORA ",
    "___________________________________________ \t___________________________________________ ",
    "Nome \tNome ",
    "Fim",
  ];
  const exportado = [
    "___________________________________________",
    "XXXXXXXXXXXXXXX         XXXXXXX",
    "PARTE LOCATÁRIA         PARTE LOCATÁRIA",
    "PARTE LOCADORA",
    "___________________________________________         ___________________________________________",
    "Nome         Nome",
  ];

  it("findBlockRange casa a sequência em colunas e para antes de 'Fim'", () => {
    const doc = fakeDoc(estrutura);
    const r = findBlockRange(doc, exportado);
    expect(r).not.toBeNull();
    const fimTexto = estrutura.slice(0, 6).map((p) => `${p}\n`).join("").length;
    expect(r!.startIndex).toBe(1);
    expect(r!.endIndex).toBe(1 + fimTexto - 1);
  });

  it("findParagraphRange e sameParagraph ignoram tabulação e pontas", () => {
    const doc = fakeDoc(estrutura);
    expect(findParagraphRange(doc, "Nome         Nome")).not.toBeNull();
    expect(sameParagraph("Nome \tNome ", "Nome         Nome")).toBe(true);
    expect(sameParagraph("Nome Nome", "Nome Outro")).toBe(false);
  });

  it("findForms continua exigindo largura 1:1 — tab não vira espaço nele", () => {
    expect(findForms("Nome \tNome", "Nome         Nome").count).toBe(0);
  });
});

describe("NBSP — o export normaliza, a estrutura não", () => {
  it("findBlockRange e findParagraphRange casam parágrafo com NBSP contra alvo com espaço", () => {
    const doc = fakeDoc(["8. GARANTIA", "8.1.\u00A0Como garantia das obrigações.", "9. FORO"]);
    expect(findParagraphRange(doc, "8.1. Como garantia das obrigações.")).not.toBeNull();
    expect(findBlockRange(doc, ["8. GARANTIA", "8.1. Como garantia das obrigações."])).not.toBeNull();
  });

  it("findForms devolve a forma REAL; realFormOf só quando única", () => {
    const real = "a) R$\u00A03.000,00 hoje. b) R$ 3.000,00 amanhã.";
    expect(findForms(real, "R$ 3.000,00").forms).toEqual(["R$\u00A03.000,00", "R$ 3.000,00"]);
    expect(realFormOf(real, "R$ 3.000,00")).toBeNull();
    expect(realFormOf(real, "R$ 3.000,00 hoje")).toBe("R$\u00A03.000,00 hoje");
    expect(realFormOf(real, "não existe")).toBeNull();
  });
});
