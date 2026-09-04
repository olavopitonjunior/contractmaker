import { describe, it, expect } from "vitest";
import {
  hasCreditConsent,
  readCreditConsent,
  withCreditConsent,
  withoutCreditConsent,
} from "../consent";

describe("creditConsent — chave canônica + legado serasaConsent", () => {
  it("lê a canônica", () => {
    const c = readCreditConsent({
      creditConsent: { at: "2026-09-04T10:00:00.000Z", by: "u1", baseLegal: "protecao_credito", provider: "fichacerta" },
    });
    expect(c).toEqual({
      at: "2026-09-04T10:00:00.000Z",
      by: "u1",
      baseLegal: "protecao_credito",
      provider: "fichacerta",
    });
  });

  it("aceita o legado serasaConsent (consentimento dado antes da troca de provedor)", () => {
    const c = readCreditConsent({
      serasaConsent: { at: "2026-05-10T10:00:00.000Z", by: "u1", baseLegal: "execucao_contrato" },
    });
    expect(c?.baseLegal).toBe("execucao_contrato");
    expect(c?.at).toBe("2026-05-10T10:00:00.000Z");
  });

  it("canônica vence o legado; sem `at` não há consentimento", () => {
    expect(
      readCreditConsent({
        creditConsent: { at: "2026-09-01T00:00:00.000Z", by: "a" },
        serasaConsent: { at: "2026-05-01T00:00:00.000Z", by: "b" },
      })?.by
    ).toBe("a");
    expect(readCreditConsent({ creditConsent: { by: "a" } })).toBeNull();
    expect(readCreditConsent(null)).toBeNull();
    expect(readCreditConsent("x")).toBeNull();
    expect(hasCreditConsent({})).toBe(false);
  });

  it("baseLegal desconhecida cai em protecao_credito", () => {
    expect(readCreditConsent({ creditConsent: { at: "x", by: "u", baseLegal: "qualquer" } })?.baseLegal).toBe(
      "protecao_credito"
    );
  });

  it("withCreditConsent preserva as outras chaves; withoutCreditConsent apaga as duas", () => {
    const next = withCreditConsent(
      { outro: 1, serasaConsent: { at: "legado", by: "b" } },
      { at: "now", by: "u", baseLegal: "protecao_credito" }
    );
    expect(next.outro).toBe(1);
    expect(readCreditConsent(next)?.at).toBe("now");
    const gone = withoutCreditConsent(next);
    expect(gone).toEqual({ outro: 1 });
    expect(hasCreditConsent(gone)).toBe(false);
  });
});
