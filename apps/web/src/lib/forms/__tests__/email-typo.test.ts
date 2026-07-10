import { describe, it, expect } from "vitest";
import { suggestEmailDomain } from "../email-typo";

describe("suggestEmailDomain", () => {
  it("corrige o domínio do incidente real (yahool.com.br → yahoo.com.br)", () => {
    expect(suggestEmailDomain("elivannogueiradequeiroz@yahool.com.br")).toBe(
      "elivannogueiradequeiroz@yahoo.com.br"
    );
  });

  it("corrige typos clássicos de gmail", () => {
    expect(suggestEmailDomain("joao@gmial.com")).toBe("joao@gmail.com");
    expect(suggestEmailDomain("joao@gmail.co")).toBe("joao@gmail.com");
    expect(suggestEmailDomain("joao@hotnail.com")).toBe("joao@hotmail.com");
  });

  it("preserva a parte local verbatim (case e pontos)", () => {
    expect(suggestEmailDomain("Maria.Souza+tag@gmial.com")).toBe(
      "Maria.Souza+tag@gmail.com"
    );
  });

  it("retorna null para domínios já corretos", () => {
    expect(suggestEmailDomain("joao@gmail.com")).toBeNull();
    expect(suggestEmailDomain("joao@yahoo.com.br")).toBeNull();
    expect(suggestEmailDomain("joao@outlook.com.br")).toBeNull();
  });

  it("retorna null para domínios corporativos legítimos (longe de provedores)", () => {
    expect(suggestEmailDomain("contato@imobiliariazimmermann.com.br")).toBeNull();
    expect(suggestEmailDomain("user@empresa.com.br")).toBeNull();
  });

  it("retorna null para inputs que não são e-mail", () => {
    expect(suggestEmailDomain("")).toBeNull();
    expect(suggestEmailDomain("semarroba")).toBeNull();
    expect(suggestEmailDomain("@gmail.com")).toBeNull();
    expect(suggestEmailDomain("joao@")).toBeNull();
    expect(suggestEmailDomain("joao@localhost")).toBeNull();
  });

  it("não é ultra-agressivo — não sugere para diferença > 2 edições", () => {
    // "protonmail.com" não está na lista e está longe de qualquer comum.
    expect(suggestEmailDomain("user@protonmail.com")).toBeNull();
  });
});
