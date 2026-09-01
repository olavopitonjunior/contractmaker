import { describe, it, expect } from "vitest";
import {
  catalogForModalidade,
  isKnownToken,
  PLACEHOLDER_CATALOG,
  requiredTokens,
} from "../placeholder-catalog";

/**
 * Rebuild da RE/MAX Trio (2026-09-01): a cláusula do objeto dos modelos
 * ingeridos ficou "apartamento 33 do condomínio Siracusa, localizado na
 * {{imovel_endereco_completo}}" e a de encargos ficou com IPTU/condomínio do
 * imóvel-fonte — não havia chave para o trecho antes do endereço nem para os
 * encargos. Casa × apartamento é preenchimento, não template.
 */
describe("catálogo — cláusula do objeto e encargos da locação", () => {
  it("imovel_identificacao é obrigatória em toda locação e não existe na venda", () => {
    for (const m of ["locacao", "locacao_comercial", "temporada"]) {
      expect(requiredTokens(m)).toContain("imovel_identificacao");
    }
    expect(isKnownToken("imovel_identificacao", "a_vista")).toBe(false);
    expect(isKnownToken("imovel_identificacao", "financiamento")).toBe(false);
  });

  it("imovel_descricao segue opcional — é a narrativa da 1.2, não o objeto", () => {
    expect(requiredTokens("locacao")).not.toContain("imovel_descricao");
    expect(isKnownToken("imovel_descricao", "locacao")).toBe(true);
  });

  it("iptu_valor e condominio_valor existem só na locação e são opcionais", () => {
    for (const m of ["locacao", "locacao_comercial", "temporada"]) {
      expect(isKnownToken("iptu_valor", m)).toBe(true);
      expect(isKnownToken("condominio_valor", m)).toBe(true);
    }
    expect(isKnownToken("iptu_valor", "a_vista")).toBe(false);
    expect(isKnownToken("condominio_valor", "administracao_locacao")).toBe(false);
    // Casa sem condomínio não pode virar "campo obrigatório ausente".
    expect(requiredTokens("locacao")).not.toContain("condominio_valor");
    expect(requiredTokens("locacao")).not.toContain("iptu_valor");
  });

  it("uma chamada não contamina a outra e nenhum token se repete", () => {
    catalogForModalidade("locacao");
    const venda = catalogForModalidade("a_vista").map((d) => d.token);
    expect(venda).not.toContain("imovel_identificacao");
    const tokens = PLACEHOLDER_CATALOG.map((d) => d.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
