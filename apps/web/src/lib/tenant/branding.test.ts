import { describe, it, expect } from "vitest";
import { hexToHslTriplet } from "./branding";

describe("hexToHslTriplet", () => {
  it("converte o verde Zimmermann #115E59 → triplet HSL próximo do token", () => {
    // token atual: 176 69% 22%
    expect(hexToHslTriplet("#115E59")).toBe("176 69% 22%");
  });

  it("aceita hex de 3 dígitos e sem #", () => {
    expect(hexToHslTriplet("fff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000")).toBe("0 0% 0%");
  });

  it("retorna null pra inválido/vazio", () => {
    expect(hexToHslTriplet("")).toBeNull();
    expect(hexToHslTriplet(null)).toBeNull();
    expect(hexToHslTriplet("nothex")).toBeNull();
    expect(hexToHslTriplet("#12")).toBeNull();
  });
});
