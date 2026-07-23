import { describe, it, expect } from "vitest";
import {
  isBlankParty,
  isAllBlankPartyArray,
  filterBlankPartyArrays,
  PARTY_ARRAY_KEYS,
} from "../blank-party";

/** Template PF exato do defaultFormValues do SalesFormWizard. */
const TEMPLATE_VENDA = {
  tipo_pessoa: "fisica",
  nome: "",
  nacionalidade: "Brasileiro(a)",
  estado_civil: "",
  profissao: "",
  rg: "",
  cpf: "",
  data_nascimento: "",
  nome_mae: "",
  sexo: "",
  email: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  cep: "",
  mobile_phone: "",
  tem_socio_pj: false,
  tem_procurador: false,
  recebimento: { banco: "", agencia: "", conta: "", pix_chave: "" },
};

/** Template do defaultValues do LocacaoFormWizard. */
const TEMPLATE_LOCACAO = {
  tipo_pessoa: "fisica",
  nome: "",
  nacionalidade: "Brasileiro(a)",
  estado_civil: "",
  incluir_como_signatario: true,
};

describe("isBlankParty", () => {
  it("template de venda (defaults preenchidos, identificadores vazios) é blank", () => {
    expect(isBlankParty(TEMPLATE_VENDA)).toBe(true);
  });

  it("template de locação é blank", () => {
    expect(isBlankParty(TEMPLATE_LOCACAO)).toBe(true);
  });

  it("qualquer identificador preenchido torna a parte não-blank", () => {
    expect(isBlankParty({ ...TEMPLATE_VENDA, nome: "João" })).toBe(false);
    expect(isBlankParty({ ...TEMPLATE_VENDA, cpf: "40019343884" })).toBe(false);
    expect(isBlankParty({ ...TEMPLATE_VENDA, email: "a@b.com" })).toBe(false);
    expect(isBlankParty({ razao_social: "ACME LTDA" })).toBe(false);
    expect(isBlankParty({ cnpj: "00000000000191" })).toBe(false);
    expect(isBlankParty({ rg: "48478909" })).toBe(false);
  });

  it("string só de whitespace conta como vazia", () => {
    expect(isBlankParty({ ...TEMPLATE_VENDA, nome: "   " })).toBe(true);
  });

  it("sub-objetos vazios (conjuge/recebimento) não tornam a parte não-blank", () => {
    expect(isBlankParty({ ...TEMPLATE_VENDA, conjuge: {} })).toBe(true);
  });

  it("não-objetos nunca são blank party", () => {
    expect(isBlankParty(null)).toBe(false);
    expect(isBlankParty(undefined)).toBe(false);
    expect(isBlankParty("João")).toBe(false);
    expect(isBlankParty([TEMPLATE_VENDA])).toBe(false);
  });

  it("objeto sem NENHUM campo identificador (todos ausentes) é blank", () => {
    // Chave ausente == vazia — o template pode nem ter cnpj/razao_social.
    expect(isBlankParty({ tipo_pessoa: "fisica" })).toBe(true);
  });
});

describe("isAllBlankPartyArray", () => {
  it("[] é false — remoção total é intenção legítima", () => {
    expect(isAllBlankPartyArray([])).toBe(false);
  });

  it("[template] é true; [template, preenchido] é false", () => {
    expect(isAllBlankPartyArray([TEMPLATE_VENDA])).toBe(true);
    expect(isAllBlankPartyArray([TEMPLATE_VENDA, { ...TEMPLATE_VENDA }])).toBe(true);
    expect(
      isAllBlankPartyArray([TEMPLATE_VENDA, { ...TEMPLATE_VENDA, nome: "Ana" }]),
    ).toBe(false);
  });

  it("não-array é false", () => {
    expect(isAllBlankPartyArray(undefined)).toBe(false);
    expect(isAllBlankPartyArray({ nome: "" })).toBe(false);
  });
});

describe("filterBlankPartyArrays", () => {
  const FILLED = [{ ...TEMPLATE_VENDA, nome: "Francielly", cpf: "40019343884" }];

  it("descarta array template-vazio quando o banco tem parte com conteúdo (cenário do bug)", () => {
    const { incoming, skippedKeys } = filterBlankPartyArrays(
      { vendedores: FILLED },
      { vendedores: [TEMPLATE_VENDA], pagamento: { valor_total: 100 } },
      PARTY_ARRAY_KEYS,
    );
    expect(skippedKeys).toEqual(["vendedores"]);
    expect(incoming).toEqual({ pagamento: { valor_total: 100 } });
  });

  it("primeiro save de form novo passa (banco sem parte não-blank)", () => {
    for (const current of [
      {},
      { vendedores: [] },
      { vendedores: [TEMPLATE_VENDA] },
    ]) {
      const { incoming, skippedKeys } = filterBlankPartyArrays(
        current,
        { vendedores: [TEMPLATE_VENDA] },
        PARTY_ARRAY_KEYS,
      );
      expect(skippedKeys).toEqual([]);
      expect(incoming).toEqual({ vendedores: [TEMPLATE_VENDA] });
    }
  });

  it("remoção legítima passa: array menor com conteúdo, ou [] total", () => {
    const twoFilled = [...FILLED, { ...TEMPLATE_VENDA, nome: "Ana" }];
    const smaller = filterBlankPartyArrays(
      { vendedores: twoFilled },
      { vendedores: FILLED },
      PARTY_ARRAY_KEYS,
    );
    expect(smaller.skippedKeys).toEqual([]);

    const total = filterBlankPartyArrays(
      { vendedores: FILLED },
      { vendedores: [] },
      PARTY_ARRAY_KEYS,
    );
    expect(total.skippedKeys).toEqual([]);
    expect(total.incoming).toEqual({ vendedores: [] });
  });

  it("chave não-protegida e chave ausente ficam intactas", () => {
    const { incoming, skippedKeys } = filterBlankPartyArrays(
      { testemunhas: [{ nome: "T" }], vendedores: FILLED },
      { testemunhas: [{ nome: "" }] },
      PARTY_ARRAY_KEYS, // testemunhas fora do set
    );
    expect(skippedKeys).toEqual([]);
    expect(incoming).toEqual({ testemunhas: [{ nome: "" }] });
  });

  it("shape inesperado (não-array no incoming ou no current) passa intacto", () => {
    const { incoming, skippedKeys } = filterBlankPartyArrays(
      { vendedores: "corrompido" as unknown as [] },
      { vendedores: [TEMPLATE_VENDA] },
      PARTY_ARRAY_KEYS,
    );
    expect(skippedKeys).toEqual([]);
    expect(incoming).toEqual({ vendedores: [TEMPLATE_VENDA] });
  });

  it("sem skip, retorna o próprio objeto incoming (sem cópia desnecessária)", () => {
    const original = { pagamento: { valor_total: 1 } };
    const { incoming } = filterBlankPartyArrays({}, original, PARTY_ARRAY_KEYS);
    expect(incoming).toBe(original);
  });
});
