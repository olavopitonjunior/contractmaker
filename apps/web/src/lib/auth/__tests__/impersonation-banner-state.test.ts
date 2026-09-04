import { describe, it, expect } from "vitest";
import { impersonationBannerState } from "../impersonation-banner-state";

describe("impersonationBannerState", () => {
  const now = Date.parse("2026-09-04T20:00:00.000Z");

  it("sessão vigente: ativa, com a hora do vencimento", () => {
    const s = impersonationBannerState("2026-09-04T21:30:00.000Z", now);
    expect(s.kind).toBe("active");
    if (s.kind === "active") {
      expect(s.remainingMs).toBe(90 * 60 * 1000);
      expect(s.expiresAtLabel).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("sessão vencida: expired — é o estado que a tela NÃO mostrava (issue #587)", () => {
    expect(impersonationBannerState("2026-09-04T19:59:59.000Z", now)).toEqual({ kind: "expired" });
    expect(impersonationBannerState("2026-09-04T20:00:00.000Z", now)).toEqual({ kind: "expired" });
  });

  it("sem vencimento conhecido ou ISO inválido: unknown (o banner mostra o texto de sempre)", () => {
    expect(impersonationBannerState(undefined, now)).toEqual({ kind: "unknown" });
    expect(impersonationBannerState("não é data", now)).toEqual({ kind: "unknown" });
  });
});
