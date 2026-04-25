import { describe, it, expect } from "vitest";
import { maskPayerName } from "../mask";

describe("maskPayerName", () => {
  it("nome composto normal retorna Primeiro + Inicial do sobrenome", () => {
    expect(maskPayerName("Maria Aparecida de Souza")).toBe("Maria S.");
  });

  it("nome simples com 2 palavras", () => {
    expect(maskPayerName("João Silva")).toBe("João S.");
  });

  it("nome com 1 palavra só retorna a palavra", () => {
    expect(maskPayerName("Maria")).toBe("Maria");
  });

  it("strip de tokens em colchetes no início", () => {
    expect(maskPayerName("[QA UX] Maria Aparecida de Souza")).toBe("Maria S.");
  });

  it("strip de múltiplos tokens em colchetes", () => {
    expect(maskPayerName("[QA][TEST] João Silva")).toBe("João S.");
  });

  it("string vazia retorna fallback", () => {
    expect(maskPayerName("")).toBe("Cliente");
  });

  it("string só de colchetes retorna fallback", () => {
    expect(maskPayerName("[X][Y]")).toBe("Cliente");
  });

  it("whitespace entre tokens é tolerado", () => {
    expect(maskPayerName("  [QA]   Maria Souza")).toBe("Maria S.");
  });

  it("acentos no primeiro nome são preservados", () => {
    expect(maskPayerName("Ágata Éléonore")).toBe("Ágata É.");
  });

  it("tokens no meio do nome não são removidos (só no início)", () => {
    expect(maskPayerName("Maria [teste] Silva")).toBe("Maria S.");
  });

  it("entrada só com pontuação retorna fallback", () => {
    expect(maskPayerName(".,;")).toBe("Cliente");
  });
});
