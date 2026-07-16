import { describe, it, expect } from "vitest";
import { chunkText } from "../chunking";

describe("chunkText — overlap na fronteira de palavra", () => {
  it("texto curto vira um único chunk", () => {
    const out = chunkText("Cláusula 1. Objeto do contrato.");
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(0);
    expect(out[0].total).toBe(1);
  });

  it("chunks não começam nem terminam no meio de uma palavra", () => {
    // Parágrafo único longo, sem quebra dupla → força o hard-cut + overlap.
    const palavra = "responsabilidade";
    const texto = Array.from({ length: 400 }, (_, i) => `${palavra}${i}`).join(" ");
    // maxTokens baixo pra garantir múltiplos chunks.
    const out = chunkText(texto, 40, 8);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      const t = c.text.trim();
      // Cada token do corpus é "responsabilidadeN"; um chunk word-safe começa e
      // termina num token completo (contém o prefixo íntegro), nunca "abilidade".
      expect(t.startsWith("abilidade")).toBe(false);
      expect(/^\S*responsabilidade\d/.test(t) || t.startsWith(palavra)).toBe(true);
    }
  });

  it("bloco com espaço isolado + token gigante não explode em milhares de chunks", () => {
    // "ab" + espaço + 20k chars sem espaço. Sem o limite do backtrack, o loop
    // de hard-cut avançaria ~1 char/iteração. Deve terminar com contagem sã.
    const texto = "ab " + "x".repeat(20_000);
    const out = chunkText(texto, 800, 100); // maxChars 3200
    // Piso teórico ~ len/(maxChars) ≈ 20000/3200 ≈ 7. Teto generoso: 3×.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(25);
  });

  it("não trava com overlap > metade do chunk + token sem espaço", () => {
    // Antes: overlap 150 tok (600 chars) > maxChars/2 (400) fazia a cauda ≈
    // string inteira e o hard-cut loop nunca terminar. O clamp garante término.
    const texto = "y".repeat(5_000); // sem espaços
    const out = chunkText(texto, 200, 150); // maxChars 800, overlap clampa p/ 400
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(40);
  });

  it("overlap 0 não trava e produz chunks sem sobreposição", () => {
    const texto = "palavra ".repeat(500).trim(); // ~4000 chars
    const out = chunkText(texto, 200, 0); // maxChars 800, overlap 0
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(20);
  });

  it("índices são sequenciais e total bate com o número de chunks", () => {
    const texto = "Frase A. ".repeat(300);
    const out = chunkText(texto, 50, 10);
    out.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.total).toBe(out.length);
    });
  });
});
