import { describe, it, expect } from "vitest";
import { partyToData, partyFromData, parseAmountInput, type PartyInput } from "../form-data";

const base: PartyInput = {
  tipoPessoa: "fisica",
  nome: "Maria Souza",
  documento: "529.982.247-25",
  email: "m@x.com",
  phone: "11999990000",
  canal: "email",
};

describe("PartyInput ↔ dataJson — campos de crédito (2026-09)", () => {
  it("sem campos novos o dataJson é o de sempre (aditivo)", () => {
    expect(partyToData(base)).toEqual({
      tipo_pessoa: "fisica",
      nome: "Maria Souza",
      email: "m@x.com",
      telefone: "11999990000",
      cpf: "52998224725",
    });
  });

  it("campos de crédito viram snake_case com os nomes do formulário de locação; vazios não entram", () => {
    const d = partyToData({
      ...base,
      dataNascimento: "1990-05-10",
      nomeMae: " Ana ",
      sexo: "F",
      rg: "",
      cep: "80000000",
      cidade: "Curitiba",
      uf: "pr",
      rendaMensal: "3.500,00",
      rendaOrigem: "11",
      rendaOutraValor: "",
      rendaOutraOrigem: "",
      conjuge: { nome: "João", documento: "111.444.777-35", rendaMensal: "1200", rendaOrigem: "5" },
    });
    expect(d).toMatchObject({
      data_nascimento: "1990-05-10",
      nome_mae: "Ana",
      sexo: "F",
      cep: "80000000",
      cidade: "Curitiba",
      uf: "PR",
      renda_mensal: 3500,
      renda_origem: 11,
      conjuge: { nome: "João", cpf: "11144477735", renda_mensal: 1200, renda_origem: 5 },
    });
    expect(d).not.toHaveProperty("rg");
    expect(d).not.toHaveProperty("renda_outra_valor");
  });

  it("round-trip: o que entra sai igual, e chaves desconhecidas (OCR, /partes) sobrevivem em `extra`", () => {
    const raw = {
      tipo_pessoa: "fisica",
      nome: "Maria",
      cpf: "52998224725",
      email: "",
      telefone: "",
      data_nascimento: "1990-05-10",
      renda_mensal: 3500,
      renda_origem: 11,
      residir: false,
      estado_civil: "casada",
      conjuge: { nome: "João", cpf: "11144477735", incluir_como_signatario: true },
    };
    const form = partyFromData(raw);
    expect(form.dataNascimento).toBe("1990-05-10");
    expect(form.rendaMensal).toBe("3.500,00");
    expect(form.rendaOrigem).toBe("11");
    expect(form.extra).toEqual({ residir: false, estado_civil: "casada" });
    expect(form.conjuge?.extra).toEqual({ incluir_como_signatario: true });

    const back = partyToData(form);
    expect(back).toEqual(raw);
  });

  it("cônjuge sem nome nem CPF não entra; trocar PF→PJ apaga cpf e escreve razão social", () => {
    expect(partyToData({ ...base, conjuge: { nome: "", documento: "" } })).not.toHaveProperty("conjuge");
    const pj = partyToData({ ...base, tipoPessoa: "juridica", documento: "11.222.333/0001-81", extra: { cpf: "old" } });
    expect(pj).toMatchObject({ tipo_pessoa: "juridica", razao_social: "Maria Souza", cnpj: "11222333000181" });
    expect(pj).not.toHaveProperty("cpf");
  });

  it("parseAmountInput: máscara BR, ponto decimal, vazio", () => {
    expect(parseAmountInput("3.500,00")).toBe(3500);
    expect(parseAmountInput("3500.5")).toBe(3500.5);
    expect(parseAmountInput("1,5")).toBe(1.5);
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("abc")).toBeNull();
  });
});
