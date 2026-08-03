import { describe, it, expect } from "vitest";
import { normalizeSearch } from "../text";

describe("normalizeSearch", () => {
  it.each([
    ["João", "joao"],
    ["reflexão", "reflexao"],
    ["SÃO JOÃO", "sao joao"],
    ["Confecção", "confeccao"],
    ["ANTES", "antes"],
    ["  Águas Claras  ", "  aguas claras  "],
  ])("normaliza %s -> %s", (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it("query sem acento acha texto acentuado e vice-versa", () => {
    const haystack = normalizeSearch("Apto 102 — Ed. Solar São João QA");
    expect(haystack.includes(normalizeSearch("sao joao"))).toBe(true);
    expect(normalizeSearch("Joao Silva").includes(normalizeSearch("joão"))).toBe(
      true
    );
  });
});
