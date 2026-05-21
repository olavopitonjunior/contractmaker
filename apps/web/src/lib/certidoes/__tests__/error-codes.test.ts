import { describe, it, expect } from "vitest";
import { isProtestoNadaConsta, isPedidoDuplicado } from "../error-codes";

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
