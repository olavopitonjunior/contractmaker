import { describe, it, expect } from "vitest";
import {
  cpfRule,
  cnpjRule,
  nomeCompletoRule,
  nomeMaeRule,
  cepRule,
  ufRule,
  telefoneRule,
  dataNascimentoRule,
  isValidBirthdate,
  isFullName,
  maskCPF,
  maskCNPJ,
  maskCEP,
  maskTelefone,
  collectPartyFormatIssues,
} from "../field-formats";

describe("field-formats — vazio sempre passa (campo opcional não bloqueia)", () => {
  it.each([cpfRule, cnpjRule, nomeCompletoRule, nomeMaeRule, cepRule, ufRule, telefoneRule, dataNascimentoRule])(
    "rule(%#) aceita vazio",
    (r) => {
      expect(r("")).toBe(true);
      expect(r("   ")).toBe(true);
      expect(r(null)).toBe(true);
      expect(r(undefined)).toBe(true);
    }
  );
});

describe("cpfRule / cnpjRule", () => {
  it("aceita CPF válido (com e sem máscara)", () => {
    expect(cpfRule("529.982.247-25")).toBe(true);
    expect(cpfRule("52998224725")).toBe(true);
  });
  it("rejeita CPF inválido", () => {
    expect(typeof cpfRule("111.111.111-11")).toBe("string");
    expect(typeof cpfRule("12345678900")).toBe("string");
  });
  it("valida CNPJ", () => {
    expect(cnpjRule("11.222.333/0001-81")).toBe(true);
    expect(typeof cnpjRule("11.222.333/0001-99")).toBe("string");
  });
});

describe("nome completo", () => {
  it("exige nome + sobrenome", () => {
    expect(isFullName("Eduardo Pereira Leite")).toBe(true);
    expect(isFullName("Eduardo")).toBe(false);
    expect(nomeCompletoRule("Maria")).not.toBe(true);
    expect(nomeCompletoRule("Maria Silva")).toBe(true);
  });
  it("limite conhecido: 'OTILIA DA GLORIA' passa (3 tokens) — formato não pega divergência da Receita", () => {
    expect(nomeMaeRule("OTILIA DA GLORIA")).toBe(true);
  });
});

describe("CEP / UF / telefone", () => {
  it("CEP 8 dígitos", () => {
    expect(cepRule("13331-265")).toBe(true);
    expect(typeof cepRule("1333")).toBe("string");
  });
  it("UF válida", () => {
    expect(ufRule("SP")).toBe(true);
    expect(ufRule("sp")).toBe(true);
    expect(typeof ufRule("XX")).toBe("string");
  });
  it("telefone 10 ou 11 dígitos", () => {
    expect(telefoneRule("(11) 99999-9999")).toBe(true);
    expect(telefoneRule("1133334444")).toBe(true);
    expect(typeof telefoneRule("999")).toBe("string");
  });
});

describe("data de nascimento", () => {
  const today = new Date(2026, 5, 1, 12); // 2026-06-01
  it("aceita ISO e DD/MM/AAAA válidas no passado", () => {
    expect(isValidBirthdate("1985-03-25", today)).toBe(true);
    expect(isValidBirthdate("25/03/1985", today)).toBe(true);
  });
  it("rejeita data futura", () => {
    expect(isValidBirthdate("2030-01-01", today)).toBe(false);
  });
  it("rejeita data de calendário inválida (31/02)", () => {
    expect(isValidBirthdate("31/02/1990", today)).toBe(false);
    expect(isValidBirthdate("1990-02-31", today)).toBe(false);
  });
  it("rejeita formato lixo", () => {
    expect(isValidBirthdate("25-03-1985", today)).toBe(false);
    expect(isValidBirthdate("ontem", today)).toBe(false);
  });
  it("dataNascimentoRule deixa vazio passar", () => {
    expect(dataNascimentoRule("")).toBe(true);
  });
});

describe("máscaras", () => {
  it("CPF", () => expect(maskCPF("52998224725")).toBe("529.982.247-25"));
  it("CNPJ", () => expect(maskCNPJ("11222333000181")).toBe("11.222.333/0001-81"));
  it("CEP", () => expect(maskCEP("13331265")).toBe("13331-265"));
  it("telefone celular", () => expect(maskTelefone("11999999999")).toBe("(11) 99999-9999"));
  it("telefone fixo", () => expect(maskTelefone("1133334444")).toBe("(11) 3333-4444"));
});

describe("collectPartyFormatIssues", () => {
  it("PF: acusa só os campos preenchidos e inválidos", () => {
    const issues = collectPartyFormatIssues({
      tipo_pessoa: "fisica",
      nome: "Eduardo Pereira Leite",
      cpf: "12345678900", // inválido
      nome_mae: "Otilia", // 1 token
      data_nascimento: "", // vazio → não bloqueia
      cep: "13331-265",
    });
    const paths = issues.map((i) => i.path).sort();
    expect(paths).toEqual(["cpf", "nome_mae"]);
  });
  it("PF totalmente válida não acusa nada", () => {
    expect(
      collectPartyFormatIssues({
        tipo_pessoa: "fisica",
        nome: "Eduardo Pereira Leite",
        cpf: "529.982.247-25",
        nome_mae: "Maria Pereira Leite",
        data_nascimento: "1980-01-10",
      })
    ).toEqual([]);
  });
  it("PJ: valida CNPJ + sub-pessoa representante", () => {
    const issues = collectPartyFormatIssues({
      tipo_pessoa: "juridica",
      razao_social: "ND Filmes LTDA",
      cnpj: "11.222.333/0001-99", // inválido
      representante: { nome: "Joao", cpf: "529.982.247-25" }, // nome 1 token
    });
    const paths = issues.map((i) => i.path).sort();
    expect(paths).toEqual(["cnpj", "representante.nome"]);
  });
});
