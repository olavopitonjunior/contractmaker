import { describe, it, expect } from "vitest";
import { normalizeSigningGroups } from "../signing-groups";

// A ClickSign só notifica o grupo N depois que o N-1 assina. Envelope sem
// grupo 1 (via "reduzida" do vendedor: todos grupo 2) nunca notificava ninguém
// na ativação — a normalização garante grupos 1..n contíguos POR envelope.
describe("normalizeSigningGroups", () => {
  it("envelope só com grupo 2 (vendedor) vira grupo 1", () => {
    const f = normalizeSigningGroups([2, 2]);
    expect(f(2)).toBe(1);
  });

  it("envelope completo 1/2 (proponentes + testemunhas) fica inalterado", () => {
    const f = normalizeSigningGroups([1, 1, 2]);
    expect(f(1)).toBe(1);
    expect(f(2)).toBe(2);
  });

  it("buracos são compactados preservando a ordem (1/3 → 1/2)", () => {
    const f = normalizeSigningGroups([3, 1]);
    expect(f(1)).toBe(1);
    expect(f(3)).toBe(2);
  });

  it("null/undefined contam como grupo 1 (default do schema)", () => {
    const f = normalizeSigningGroups([null, 2]);
    expect(f(null)).toBe(1);
    expect(f(undefined)).toBe(1);
    expect(f(2)).toBe(2);
  });

  it("grupo desconhecido cai em 1 (defensivo)", () => {
    const f = normalizeSigningGroups([1]);
    expect(f(99)).toBe(1);
  });
});
