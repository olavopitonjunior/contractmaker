import { describe, expect, it } from "vitest";
import { stripActiveContent } from "@/lib/proposals/preview-html";

/**
 * A proposta em nova guia (pedido de 28/07) NÃO pode abrir o HTML com a origem
 * da aplicação — nem por `blob:`, nem por `document.write` do conteúdo. O
 * `dataJson` vem de digitação humana e de OCR, e `stripActiveContent` é um
 * filtro de superfície conhecida, não um sanitizador de propósito geral: a
 * segunda camada de defesa (`<iframe sandbox="">`, sem `allow-scripts` e sem
 * `allow-same-origin`) é o que garante que nada escapado dele execute.
 *
 * Estes testes fixam o motivo: mostram um payload que ATRAVESSA o filtro, para
 * que ninguém "simplifique" a nova guia abrindo o documento direto.
 */
describe("stripActiveContent — por que a nova guia continua em iframe sandbox", () => {
  it("remove o que a superfície conhecida cobre", () => {
    const sujo =
      '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(1)">' +
      '<a href="javascript:alert(1)">x</a><iframe src="//evil"></iframe>';
    const limpo = stripActiveContent(sujo);
    expect(limpo).toContain("<p>ok</p>");
    expect(limpo).not.toContain("<script");
    expect(limpo).not.toContain("onerror");
    expect(limpo).not.toContain("javascript:");
    expect(limpo).not.toContain("<iframe");
  });

  it("mas NÃO é um sanitizador completo — um <svg onload> aninhado sobrevive", () => {
    // `on[a-z]+=` só casa quando há um espaço antes; um handler colado numa
    // aspa de atributo anterior escapa. Basta um caso para justificar o sandbox.
    const payload = '<svg/onload=alert(1)>';
    expect(stripActiveContent(payload)).toContain("onload");
  });

  it("estilo e tabelas do documento passam intactos — é o ponto do preview", () => {
    const doc =
      '<table style="width:100%"><tr><td>Valor</td><td>R$ 2.500,00</td></tr></table>';
    expect(stripActiveContent(doc)).toBe(doc);
  });
});
