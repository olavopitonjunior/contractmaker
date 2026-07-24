import { describe, it, expect } from "vitest";
import { isMarried, isExplicitlyUnmarried } from "../estado-civil";

describe("isMarried", () => {
  it("aceita os rótulos canônicos do formulário", () => {
    expect(isMarried("Casado(a)")).toBe(true);
    expect(isMarried("União Estável")).toBe(true);
  });

  it("aceita as variantes que o OCR devolve", () => {
    // Prompts do Gemini pedem "União estável" (minúsculo).
    expect(isMarried("União estável")).toBe(true);
    expect(isMarried("Uniao Estavel")).toBe(true);
    expect(isMarried("uniao estavel")).toBe(true);
    expect(isMarried("casada")).toBe(true);
    expect(isMarried("CASADO")).toBe(true);
    expect(isMarried("  Casado(a)  ")).toBe(true);
  });

  it("recusa os demais estados civis e valores vazios", () => {
    for (const v of [
      "Solteiro(a)",
      "Divorciado(a)",
      "Viúvo(a)",
      "Separado(a)",
      "",
      "   ",
      undefined,
      null,
    ]) {
      expect(isMarried(v), String(v)).toBe(false);
    }
  });
});

describe("isExplicitlyUnmarried", () => {
  it("só é true pra quem declarou não ter cônjuge", () => {
    for (const v of ["Solteiro(a)", "Divorciado(a)", "Viúvo(a)", "Separado(a)", "viúva", "SOLTEIRO"]) {
      expect(isExplicitlyUnmarried(v), String(v)).toBe(true);
    }
  });

  it("é false quando casado, ausente ou desconhecido", () => {
    // Ausente/desconhecido NÃO exclui: um dataJson legado ou do OCR sem
    // estado_civil derrubaria a outorga de um casal de verdade.
    for (const v of ["Casado(a)", "União estável", "", undefined, null, "Outro"]) {
      expect(isExplicitlyUnmarried(v), String(v)).toBe(false);
    }
  });
});
