import { describe, it, expect } from "vitest";
import {
  rendaEmCentavos,
  erroDePessoais,
  erroDeEndereco,
} from "@/components/settings/ProfileClient";

/**
 * Estes validadores espelham, campo a campo, o Zod de `PATCH /api/me/profile`.
 * Eles existem porque a tela perdeu o botão "Salvar": antes, só saía requisição
 * quando a pessoa declarava ter terminado de digitar, e o estado intermediário
 * nunca chegava à rota. Com auto-save, cada tecla é uma candidata a PATCH.
 *
 * Errar para os DOIS lados custa caro, e por isso cada regra tem os dois casos:
 *
 *  - **frouxo demais** → 400 a cada tecla (`name` é `min(1)`, `addressState` é
 *    `length(2)`, o CEP exige 8 dígitos, o CPF passa por dígito verificador);
 *  - **rígido demais** → o valor BOM nunca é gravado, e o usuário não tem mais
 *    botão para forçar. É o pior dos dois, porque é silencioso.
 */

const PESSOAIS_OK = {
  name: "Olavo Piton",
  phone: null,
  cpf: null,
  birthDate: null,
  incomeValueCents: null,
};

describe("rendaEmCentavos", () => {
  it("campo vazio é 'não informado', NUNCA zero", () => {
    // `Number("")` é 0 e passa em isFinite. Gravar 0 aqui diria à subconta
    // Asaas que a pessoa declarou não ter renda.
    expect(rendaEmCentavos("")).toBeNull();
    expect(rendaEmCentavos("   ")).toBeNull();
    expect(rendaEmCentavos("")).not.toBe(0);
  });

  it("aceita vírgula decimal e separador de milhar do padrão BR", () => {
    expect(rendaEmCentavos("1234,56")).toBe(123456);
    expect(rendaEmCentavos("1.234,56")).toBe(123456);
    expect(rendaEmCentavos("10")).toBe(1000);
  });

  it("zero digitado de propósito é gravado como zero", () => {
    expect(rendaEmCentavos("0")).toBe(0);
  });

  it("texto que ainda não é número devolve NaN, que a validação reprova", () => {
    expect(Number.isNaN(rendaEmCentavos("abc") as number)).toBe(true);
    expect(Number.isNaN(rendaEmCentavos("-5") as number)).toBe(true);
    expect(
      erroDePessoais({ ...PESSOAIS_OK, incomeValueCents: Number.NaN })
        .incomeValueCents,
    ).toBeTruthy();
  });

  it("renda válida e finita não acusa nada", () => {
    expect(
      erroDePessoais({ ...PESSOAIS_OK, incomeValueCents: 500_000 }),
    ).toEqual({});
  });

  it("renda acima do teto do Zod é erro — senão vira 400 a cada debounce", () => {
    expect(
      erroDePessoais({ ...PESSOAIS_OK, incomeValueCents: 2_000_000_001 })
        .incomeValueCents,
    ).toBeTruthy();
    expect(
      erroDePessoais({ ...PESSOAIS_OK, incomeValueCents: 2_000_000_000 })
        .incomeValueCents,
    ).toBeUndefined();
  });
});

describe("erroDePessoais", () => {
  it("o caso comum não acusa nada", () => {
    expect(erroDePessoais(PESSOAIS_OK)).toEqual({});
  });

  it("nome vazio é erro — a rota é min(1) e devolveria 400", () => {
    expect(erroDePessoais({ ...PESSOAIS_OK, name: "" }).name).toBeTruthy();
    expect(erroDePessoais({ ...PESSOAIS_OK, name: "   " }).name).toBeTruthy();
  });

  it("CPF só viaja quando fecha o dígito verificador", () => {
    expect(erroDePessoais({ ...PESSOAIS_OK, cpf: "111.444.777-3" }).cpf).toBeTruthy();
    expect(erroDePessoais({ ...PESSOAIS_OK, cpf: "111.444.777-35" }).cpf).toBeUndefined();
  });

  it("CPF ausente NÃO é erro — o campo é opcional", () => {
    // Rígido demais aqui travaria a seção inteira de quem não preencheu CPF:
    // sem botão, o nome também deixaria de ser gravado.
    expect(erroDePessoais({ ...PESSOAIS_OK, cpf: null }).cpf).toBeUndefined();
  });

  it("telefone parcial é erro; completo passa; ausente passa", () => {
    expect(erroDePessoais({ ...PESSOAIS_OK, phone: "(11) 9" }).phone).toBeTruthy();
    expect(
      erroDePessoais({ ...PESSOAIS_OK, phone: "(11) 99999-0000" }).phone,
    ).toBeUndefined();
    expect(erroDePessoais({ ...PESSOAIS_OK, phone: null }).phone).toBeUndefined();
  });

  it("ano implausível do input type=date é digitação em curso, não data", () => {
    expect(erroDePessoais({ ...PESSOAIS_OK, birthDate: "0002-01-01" }).birthDate)
      .toBeTruthy();
    expect(erroDePessoais({ ...PESSOAIS_OK, birthDate: "1985-03-20" }).birthDate)
      .toBeUndefined();
  });

  it("data no futuro é erro", () => {
    const ano = new Date().getFullYear() + 5;
    expect(erroDePessoais({ ...PESSOAIS_OK, birthDate: `${ano}-01-01` }).birthDate)
      .toBeTruthy();
  });

  it("as duas FRONTEIRAS exatas de ano são aceitas", () => {
    // Sem estes dois, trocar `<` por `<=` na implementação passaria batido — e
    // rejeitar a fronteira significa nunca gravar uma data legítima.
    const atual = new Date().getFullYear();
    expect(erroDePessoais({ ...PESSOAIS_OK, birthDate: "1900-01-01" }).birthDate)
      .toBeUndefined();
    expect(
      erroDePessoais({ ...PESSOAIS_OK, birthDate: `${atual}-01-01` }).birthDate,
    ).toBeUndefined();
    expect(erroDePessoais({ ...PESSOAIS_OK, birthDate: "1899-12-31" }).birthDate)
      .toBeTruthy();
  });

  it("nome longo demais é erro — a rota é max(200)", () => {
    expect(erroDePessoais({ ...PESSOAIS_OK, name: "a".repeat(201) }).name)
      .toBeTruthy();
    expect(erroDePessoais({ ...PESSOAIS_OK, name: "a".repeat(200) }).name)
      .toBeUndefined();
  });

  it("as chaves do erro são as chaves do PAYLOAD", () => {
    // `invalidKeys` remove do PATCH exatamente as chaves devolvidas aqui. Se um
    // rótulo de tela vazasse para cá ("income" em vez de "incomeValueCents"), o
    // filtro removeria uma chave que não existe e o valor ruim viajaria.
    const erros = erroDePessoais({
      name: "",
      phone: "(11) 9",
      cpf: "111",
      birthDate: "0002-01-01",
      incomeValueCents: Number.NaN,
    });
    expect(Object.keys(erros).sort()).toEqual(
      ["birthDate", "cpf", "incomeValueCents", "name", "phone"].sort(),
    );
  });
});

describe("erroDeEndereco", () => {
  it("tudo vazio não acusa nada — o endereço inteiro é opcional", () => {
    expect(erroDeEndereco({ postalCode: null, addressState: null })).toEqual({});
  });

  it("CEP parcial é erro; 8 dígitos passa, com ou sem máscara", () => {
    expect(erroDeEndereco({ postalCode: "0458", addressState: null }).postalCode)
      .toBeTruthy();
    expect(erroDeEndereco({ postalCode: "04581-050", addressState: null }).postalCode)
      .toBeUndefined();
    expect(erroDeEndereco({ postalCode: "04581050", addressState: null }).postalCode)
      .toBeUndefined();
  });

  it("UF com uma letra é erro — a rota é length(2)", () => {
    expect(erroDeEndereco({ postalCode: null, addressState: "S" }).addressState)
      .toBeTruthy();
    expect(erroDeEndereco({ postalCode: null, addressState: "SP" }).addressState)
      .toBeUndefined();
  });

  it("texto colado além do max() da rota é erro, e na chave certa", () => {
    const e = erroDeEndereco({
      postalCode: null,
      addressState: null,
      addressComplement: "x".repeat(101),
      addressStreet: "y".repeat(200),
    });
    expect(e.addressComplement).toBeTruthy();
    expect(e.addressStreet).toBeUndefined();
  });
});
