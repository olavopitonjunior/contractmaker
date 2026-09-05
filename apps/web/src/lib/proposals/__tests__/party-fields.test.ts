import { describe, it, expect } from "vitest";
import { applyPartyFields, getAtPath, isPartyTargetAllowed, validatePartyFields } from "../party-fields";

describe("validatePartyFields — allowlist da rota /partes", () => {
  it("chave fora da allowlist → erro (nada de `dataJson.comissao` por aqui)", () => {
    expect(validatePartyFields({ comissao: 1 })).toEqual({ ok: false, error: "Campo não permitido: comissao" });
    expect(validatePartyFields({ __proto__: {} }).ok).toBe(false);
  });

  it("tipos: string aparada e limitada, número finito ≥ 0, booleano; \"\"/null apagam", () => {
    const r = validatePartyFields({
      nome_mae: "  Ana  ",
      renda_mensal: "3500.5",
      renda_origem: 11,
      residir: false,
      rg: null,
      renda_outra_valor: "",
    });
    expect(r).toEqual({
      ok: true,
      fields: { nome_mae: "Ana", renda_mensal: 3500.5, renda_origem: 11, residir: false, rg: "", renda_outra_valor: "" },
    });
    expect(validatePartyFields({ renda_mensal: -1 }).ok).toBe(false);
    expect(validatePartyFields({ renda_mensal: "abc" }).ok).toBe(false);
    expect(validatePartyFields({ residir: "sim" }).ok).toBe(false);
    expect(validatePartyFields({ nome: 5 }).ok).toBe(false);
    expect(validatePartyFields({}).ok).toBe(false);
  });

  it("alvos por esteira", () => {
    expect(isPartyTargetAllowed("fiador", "locacao")).toBe(true);
    expect(isPartyTargetAllowed("conjuge_fiador", "locacao")).toBe(true);
    expect(isPartyTargetAllowed("comprador", "locacao")).toBe(false);
    expect(isPartyTargetAllowed("vendedor", "venda")).toBe(true);
    expect(isPartyTargetAllowed("locatario", "venda")).toBe(false);
    expect(isPartyTargetAllowed("imovel", "locacao")).toBe(false);
  });
});

describe("applyPartyFields — escrita imutável no caminho da parte", () => {
  const root = {
    locatarios: [{ nome: "Maria", cpf: "1" }, { nome: "José" }],
    garantia: { tipo: "fiador", fiador: { nome: "F" } },
    comissao: { percentual: 5 },
  };

  it("grava no índice certo, apaga com \"\" e não muta a entrada", () => {
    const out = applyPartyFields(root, "locatarios.1", { data_nascimento: "1990-01-01", nome: "" });
    expect(getAtPath(out, "locatarios.1")).toEqual({ data_nascimento: "1990-01-01" });
    expect(getAtPath(out, "locatarios.0")).toEqual({ nome: "Maria", cpf: "1" });
    expect(root.locatarios[1]).toEqual({ nome: "José" });
    // o resto do dataJson é o MESMO objeto (compartilhado, não reescrito)
    expect((out as { comissao: unknown }).comissao).toBe(root.comissao);
  });

  it("cria o cônjuge sob o fiador quando não existe", () => {
    const out = applyPartyFields(root, "garantia.fiador.conjuge", { nome: "Helena", cpf: "2" });
    expect(getAtPath(out, "garantia.fiador")).toEqual({ nome: "F", conjuge: { nome: "Helena", cpf: "2" } });
    expect(root.garantia.fiador).toEqual({ nome: "F" });
  });
});
