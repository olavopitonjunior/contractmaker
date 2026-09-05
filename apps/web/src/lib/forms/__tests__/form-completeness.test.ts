import { describe, it, expect } from "vitest";
import { checkFormCompleteness } from "../form-completeness";

const LOCACAO_OK = {
  locadores: [{ tipo_pessoa: "fisica", nome: "João Locador" }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
  imovel: { descricao: "Apartamento de 2 quartos no Centro" },
  aluguel: { valor: 2500 },
};

describe("checkFormCompleteness — o formulário só nasce 'completo' quando as PARTES estão lá", () => {
  it("locação sem locador (o caso da proposta convertida) → incompleto, e diz o que falta", () => {
    const r = checkFormCompleteness("locacao_residencial_v1", {
      locatarios: LOCACAO_OK.locatarios,
      aluguel: { valor: 2500 },
    });
    expect(r).toMatchObject({ complete: false, checked: true });
    expect(r.missing).toContain("locadores");
    // a mensagem em português é o que a tela mostra ao barrar a geração
    expect(r.messages.join(" ")).toMatch(/locador/i);
  });

  it("parte presente mas sem identidade também bloqueia (mesma regra do finalize)", () => {
    const r = checkFormCompleteness("locacao_residencial_v1", {
      ...LOCACAO_OK,
      locatarios: [{ tipo_pessoa: "fisica", nome: "" }],
    });
    expect(r.complete).toBe(false);
    expect(r.missing.some((m) => m.startsWith("locatarios"))).toBe(true);
  });

  it("locação com as duas partes → completo", () => {
    expect(checkFormCompleteness("locacao_residencial_v1", LOCACAO_OK)).toEqual({
      complete: true,
      missing: [],
      messages: [],
      checked: true,
    });
  });

  it("locação comercial usa a mesma regra", () => {
    expect(checkFormCompleteness("locacao_comercial_v1", LOCACAO_OK).complete).toBe(true);
    expect(checkFormCompleteness("locacao_comercial_v1", {}).complete).toBe(false);
  });

  it("VENDA não é julgada: sem regra de bloqueio duro, mantém o comportamento antigo", () => {
    // Medido em produção: o schema Zod inteiro reprovaria 17/17 das propostas de
    // venda (quase todas por `imoveis.0.descricao`, que a proposta nem coleta).
    expect(checkFormCompleteness("compra_venda_v1", {})).toEqual({
      complete: true,
      missing: [],
      messages: [],
      checked: false,
    });
    expect(checkFormCompleteness("compra_venda_v2", {}).checked).toBe(false);
    expect(checkFormCompleteness("administracao_locacao_v1", {}).checked).toBe(false);
  });

  it("dataJson lixo não lança; vira 'sem as partes', que é o lado seguro (formulário aberto)", () => {
    expect(() => checkFormCompleteness("locacao_residencial_v1", null)).not.toThrow();
    for (const lixo of [null, undefined, "x", 42, []]) {
      const r = checkFormCompleteness("locacao_residencial_v1", lixo);
      expect(r.complete).toBe(false);
      expect(r.missing).toContain("locadores");
    }
  });

  it("lista de faltantes é limitada (não vira dump no evento)", () => {
    const muitos = {
      locadores: Array.from({ length: 40 }, () => ({ tipo_pessoa: "fisica", nome: "" })),
      locatarios: [{ tipo_pessoa: "fisica", nome: "Maria" }],
    };
    expect(checkFormCompleteness("locacao_residencial_v1", muitos).missing.length).toBeLessThanOrEqual(30);
  });
});
