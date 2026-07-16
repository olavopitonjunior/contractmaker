import { describe, it, expect } from "vitest";
import { toClicksignPhone, channelToAuth } from "../send-execute";

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

describe("channelToAuth", () => {
  it("whatsapp → whatsapp (independente do padrão da org)", () => {
    expect(channelToAuth("whatsapp", "email")).toBe("whatsapp");
    expect(channelToAuth("whatsapp", "icp_brasil")).toBe("whatsapp");
  });

  it("email → padrão da org", () => {
    expect(channelToAuth("email", "email")).toBe("email");
    expect(channelToAuth("email", "selfie")).toBe("selfie");
  });

  it("sms/desconhecido/null → padrão da org (sms não é AuthMethod v3)", () => {
    expect(channelToAuth("sms", "email")).toBe("email");
    expect(channelToAuth(null, "email")).toBe("email");
    expect(channelToAuth(undefined, "icp_brasil")).toBe("icp_brasil");
  });
});
