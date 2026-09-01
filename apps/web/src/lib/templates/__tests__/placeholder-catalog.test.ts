import { describe, it, expect } from "vitest";
import {
  catalogForModalidade,
  isKnownToken,
  PLACEHOLDER_CATALOG,
  requiredTokens,
} from "../placeholder-catalog";

/**
 * Rebuild da RE/MAX Trio (2026-09-01): a 1.1 dos modelos ingeridos ficou
 * "apartamento 33 do condomínio Siracusa, localizado na {{imovel_endereco_completo}}"
 * e a 9.1.2 ficou com IPTU/condomínio do imóvel-fonte, porque a descrição não
 * era obrigatória e não havia chave para os encargos.
 */
describe("catálogo — obrigatoriedade por modalidade (requiredIn)", () => {
  it("imovel_descricao é obrigatória na locação e segue opcional na venda", () => {
    expect(requiredTokens("locacao")).toContain("imovel_descricao");
    expect(requiredTokens("locacao_comercial")).toContain("imovel_descricao");
    expect(requiredTokens("temporada")).toContain("imovel_descricao");
    expect(requiredTokens("a_vista")).not.toContain("imovel_descricao");
    expect(requiredTokens("financiamento")).not.toContain("imovel_descricao");
  });

  it("o prompt da IA e a revisão leem de catalogForModalidade — lá o required já vem resolvido", () => {
    const locacao = catalogForModalidade("locacao").find((d) => d.token === "imovel_descricao");
    const venda = catalogForModalidade("a_vista").find((d) => d.token === "imovel_descricao");
    expect(locacao?.required).toBe(true);
    expect(venda?.required).toBe(false);
    // A entrada canônica NÃO é mutada: uma chamada não contamina a outra.
    expect(PLACEHOLDER_CATALOG.find((d) => d.token === "imovel_descricao")?.required).toBe(false);
  });
});

describe("catálogo — encargos da locação", () => {
  it("iptu_valor e condominio_valor existem só na locação", () => {
    for (const m of ["locacao", "locacao_comercial", "temporada"]) {
      expect(isKnownToken("iptu_valor", m)).toBe(true);
      expect(isKnownToken("condominio_valor", m)).toBe(true);
    }
    expect(isKnownToken("iptu_valor", "a_vista")).toBe(false);
    expect(isKnownToken("condominio_valor", "administracao_locacao")).toBe(false);
  });

  it("são opcionais: casa sem condomínio não pode virar campo obrigatório ausente", () => {
    expect(requiredTokens("locacao")).not.toContain("condominio_valor");
    expect(requiredTokens("locacao")).not.toContain("iptu_valor");
  });

  it("nenhum token duplicado no catálogo", () => {
    const tokens = PLACEHOLDER_CATALOG.map((d) => d.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
