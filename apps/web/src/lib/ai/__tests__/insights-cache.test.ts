import { describe, it, expect } from "vitest";
import { hashSnapshot, cacheKey } from "../insights-cache";

describe("insights-cache helpers", () => {
  describe("hashSnapshot", () => {
    it("gera mesmo hash pro mesmo input", () => {
      const a = { foo: 1, bar: [1, 2] };
      const b = { foo: 1, bar: [1, 2] };
      expect(hashSnapshot(a)).toBe(hashSnapshot(b));
    });

    it("gera hash diferente pra inputs diferentes", () => {
      expect(hashSnapshot({ foo: 1 })).not.toBe(hashSnapshot({ foo: 2 }));
    });

    it("retorna string curta (16 chars)", () => {
      expect(hashSnapshot({ x: "test" })).toHaveLength(16);
    });
  });

  describe("cacheKey", () => {
    it("formata chave canônica", () => {
      expect(cacheKey("dashboard", "org1", "abc123")).toBe("insights:dashboard:org1:abc123");
    });
  });
});
