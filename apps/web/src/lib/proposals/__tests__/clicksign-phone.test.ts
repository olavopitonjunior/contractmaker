import { describe, it, expect } from "vitest";
import { toClicksignPhone } from "../send-execute";

describe("toClicksignPhone", () => {
  it("E.164 BR (+55) → dígitos nacionais (sem DDI, sem +)", () => {
    expect(toClicksignPhone("+5511999063228")).toBe("11999063228");
  });

  it("dígitos com DDI (5511…) → nacional", () => {
    expect(toClicksignPhone("5511999063228")).toBe("11999063228");
  });

  it("já nacional → inalterado", () => {
    expect(toClicksignPhone("11999063228")).toBe("11999063228");
  });

  it("máscara → só dígitos nacionais", () => {
    expect(toClicksignPhone("(11) 99906-3228")).toBe("11999063228");
  });

  it("fixo com DDI (12 díg.) → nacional 10 díg.", () => {
    expect(toClicksignPhone("551132001000")).toBe("1132001000");
  });

  it("vazio/null → undefined", () => {
    expect(toClicksignPhone(null)).toBeUndefined();
    expect(toClicksignPhone("")).toBeUndefined();
  });
});
