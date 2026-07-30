import { describe, it, expect } from "vitest";
import { stripActiveContent } from "../preview-html";

describe("stripActiveContent", () => {
  it("remove <script> com o conteúdo", () => {
    const out = stripActiveContent('<p>ok</p><script>alert("x")</script><p>fim</p>');
    expect(out).not.toContain("alert");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("<p>ok</p>");
    expect(out).toContain("<p>fim</p>");
  });

  it("remove iframe/object/embed aninhados no documento", () => {
    const out = stripActiveContent(
      '<iframe src="http://evil"></iframe><object data="x"></object><embed src="y">'
    );
    expect(out.trim()).toBe("");
  });

  it("remove handlers inline em qualquer forma de aspas", () => {
    const out = stripActiveContent(
      `<img src="a.png" onerror="steal()"><div onclick='go()'>x</div><b onmouseover=go>y</b>`
    );
    expect(out).not.toMatch(/onerror|onclick|onmouseover/i);
    expect(out).toContain('<img src="a.png">');
  });

  it("remove href/src javascript:, inclusive ofuscado com espaços", () => {
    const out = stripActiveContent(
      `<a href="javascript:alert(1)">a</a><a href="java script:alert(2)">b</a>`
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/java\s*script\s*:/i);
  });

  it("preserva o markup do documento (tabelas, estilo inline, texto)", () => {
    const html =
      '<table style="width:100%"><tr><td style="border-bottom:1px solid #000">João &amp; Cia</td></tr></table>';
    expect(stripActiveContent(html)).toBe(html);
  });

  it("string vazia é no-op", () => {
    expect(stripActiveContent("")).toBe("");
  });
});
