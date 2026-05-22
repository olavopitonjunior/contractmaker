import { describe, it, expect } from "vitest";
import {
  isProtestoNadaConsta,
  isPedidoDuplicado,
  decideObterOutcome,
} from "../error-codes";

describe("isProtestoNadaConsta", () => {
  it("casa 'não constam protestos' em endpoint de protesto", () => {
    expect(
      isProtestoNadaConsta(
        "cenprot-sp/protestos",
        "Não constam protestos nos cartórios participantes, cuja abrangência em SP é de 100%"
      )
    ).toBe(true);
  });

  it("casa 'nada consta' em ieptb", () => {
    expect(isProtestoNadaConsta("ieptb/protestos", "Nada consta")).toBe(true);
  });

  it("NÃO casa em endpoint que não é de protesto (PGFN)", () => {
    expect(
      isProtestoNadaConsta("receita-federal/pgfn", "Não constam protestos")
    ).toBe(false);
  });

  it("NÃO casa fetch failed / portal indisponível", () => {
    expect(
      isProtestoNadaConsta(
        "cenprot-sp/protestos",
        "O site ou aplicativo de origem parece estar indisponível."
      )
    ).toBe(false);
  });

  it("mensagem vazia → false", () => {
    expect(isProtestoNadaConsta("cenprot-sp/protestos", null)).toBe(false);
  });
});

describe("isPedidoDuplicado", () => {
  it("casa 'Já existe(m) pedido(s)...'", () => {
    expect(
      isPedidoDuplicado(
        "Já existe(m) pedido(s) com os dados informados para o(s) tipo(s) de certidão: Cível. Aguarde o processamento do pedido atual."
      )
    ).toBe(true);
  });

  it("casa 'aguarde o processamento do pedido'", () => {
    expect(isPedidoDuplicado("Aguarde o processamento do pedido atual.")).toBe(
      true
    );
  });

  it("NÃO casa erro de 2FA GOV.BR (também é code 620)", () => {
    expect(
      isPedidoDuplicado(
        "A verificação em duas etapas está ativada na sua conta GOV.BR. Você pode desativar..."
      )
    ).toBe(false);
  });

  it("NÃO casa 'email inválido' (608)", () => {
    expect(isPedidoDuplicado("Favor preencher com um email válido")).toBe(false);
  });

  it("mensagem vazia → false", () => {
    expect(isPedidoDuplicado(null)).toBe(false);
  });
});

describe("decideObterOutcome (limite de retry do 2º passo)", () => {
  const within = { ageMs: 1000, attempts: 1, maxRetries: 3, maxWaitMs: 12 * 60 * 60_000 };

  it("account_issue (603) → falha imediata, independente de tentativas/idade", () => {
    expect(decideObterOutcome("account_issue", within)).toEqual({ action: "fail", reason: "account" });
    expect(
      decideObterOutcome("account_issue", { ageMs: 0, attempts: 1, maxRetries: 3, maxWaitMs: 9e9 })
    ).toEqual({ action: "fail", reason: "account" });
  });

  it("integration_error (602) → falha imediata", () => {
    expect(decideObterOutcome("integration_error", within)).toEqual({ action: "fail", reason: "integration" });
  });

  it("portal_unavailable com tentativas < max → retry", () => {
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 1, maxRetries: 3 })).toEqual({ action: "retry" });
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 2, maxRetries: 3 })).toEqual({ action: "retry" });
  });

  it("portal_unavailable na 3ª tentativa → falha (esgotou)", () => {
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 3, maxRetries: 3 })).toEqual({ action: "fail", reason: "transient_exhausted" });
  });

  it("rate_limited também é transitório (bounded)", () => {
    expect(decideObterOutcome("rate_limited", { ...within, attempts: 3, maxRetries: 3 })).toEqual({ action: "fail", reason: "transient_exhausted" });
  });

  it("ainda processando dentro do prazo → wait (não conta tentativa)", () => {
    expect(decideObterOutcome("genuine_no_data", within)).toEqual({ action: "wait" });
    expect(decideObterOutcome("missing_input", within)).toEqual({ action: "wait" });
  });

  it("ainda processando além do prazo → falha (deadline)", () => {
    expect(
      decideObterOutcome("genuine_no_data", { ageMs: 13 * 60 * 60_000, attempts: 1, maxRetries: 3, maxWaitMs: 12 * 60 * 60_000 })
    ).toEqual({ action: "fail", reason: "deadline" });
  });
});
