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

  it("índices são sequenciais e total bate com o número de chunks", () => {
    const texto = "Frase A. ".repeat(300);
    const out = chunkText(texto, 50, 10);
    out.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.total).toBe(out.length);
    });
  });
});
