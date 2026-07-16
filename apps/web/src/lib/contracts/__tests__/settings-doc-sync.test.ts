import { describe, it, expect } from "vitest";
import {
  htmlToParagraphs,
  planParagraphChanges,
} from "@/lib/contracts/settings-doc-sync";

describe("htmlToParagraphs", () => {
  it("quebra por bloco e ignora tags inline", () => {
    expect(
      htmlToParagraphs("<p><strong>8.1.</strong> Multa de <em>2%</em>.</p><p>Outra.</p>")
    ).toEqual(["8.1. Multa de 2%.", "Outra."]);
  });

  it("descarta os slots de cláusula (o Drive não os importa)", () => {
    expect(htmlToParagraphs("<p>A</p><!-- CLAUSE_SLOT:G3 --><p>B</p>")).toEqual([
      "A",
      "B",
    ]);
  });

  it("decodifica entidades e colapsa whitespace como o import do Docs", () => {
    expect(htmlToParagraphs("<p>R$&nbsp;500,00   e   mais &amp; outro</p>")).toEqual([
      "R$ 500,00 e mais & outro",
    ]);
  });

  it("li e br viram parágrafos próprios", () => {
    expect(htmlToParagraphs("<ul><li>Um</li><li>Dois</li></ul><p>A<br>B</p>")).toEqual([
      "Um",
      "Dois",
      "A",
      "B",
    ]);
  });
});

describe("planParagraphChanges", () => {
  it("sem mudança, nada a fazer", () => {
    const p = planParagraphChanges(["A", "B"], ["A", "B"]);
    expect(p.replacements).toEqual([]);
    expect(p.insertions).toEqual([]);
    expect(p.deletions).toEqual([]);
  });

  it("parágrafo alterado vira replace pareado", () => {
    const p = planParagraphChanges(
      ["Multa de 2%.", "Juros de 1%."],
      ["Multa de 3%.", "Juros de 1%."]
    );
    expect(p.replacements).toEqual([{ before: "Multa de 2%.", after: "Multa de 3%." }]);
    expect(p.insertions).toEqual([]);
    expect(p.deletions).toEqual([]);
  });

  it("bloco maior vira menor (foro: arbitragem → justiça comum)", () => {
    // O caso que exige LCS: não é 1-pra-1, o bloco encolhe e desloca o resto.
    const p = planParagraphChanges(
      ["Antes.", "Arbitragem 1", "Arbitragem 2", "Arbitragem 3", "Depois."],
      ["Antes.", "Justiça comum", "Depois."]
    );
    expect(p.replacements).toEqual([
      { before: "Arbitragem 1", after: "Justiça comum" },
    ]);
    expect(p.deletions).toEqual(["Arbitragem 2", "Arbitragem 3"]);
    expect(p.insertions).toEqual([]);
  });

  it("cláusula nova (desistência ligada) vira inserção pura", () => {
    const p = planParagraphChanges(
      ["9.4. Atraso.", "10. Foro."],
      ["9.4. Atraso.", "9.5. Desistência em 7 dias.", "10. Foro."]
    );
    expect(p.insertions).toEqual(["9.5. Desistência em 7 dias."]);
    expect(p.replacements).toEqual([]);
  });

  it("cláusula removida (desistência desligada) vira deleção pura", () => {
    const p = planParagraphChanges(
      ["9.4. Atraso.", "9.5. Desistência.", "10. Foro."],
      ["9.4. Atraso.", "10. Foro."]
    );
    expect(p.deletions).toEqual(["9.5. Desistência."]);
    expect(p.replacements).toEqual([]);
  });

  it("não confunde parágrafos deslocados com alteração", () => {
    // Inserir no meio não pode fazer o resto do documento inteiro virar replace.
    const p = planParagraphChanges(["A", "B", "C"], ["A", "NOVO", "B", "C"]);
    expect(p.replacements).toEqual([]);
    expect(p.insertions).toEqual(["NOVO"]);
  });
});
