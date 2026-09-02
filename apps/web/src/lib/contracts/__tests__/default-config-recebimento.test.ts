/**
 * `locacao_recebimento` — onde a própria imobiliária recebe a comissão do 1º
 * aluguel (`contractDefaultsJson`). Terceira chave irmã de `locacao` e
 * `locacao_comissao`; alimenta `{{imobiliaria_dados_pagamento}}`.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCACAO_RECEBIMENTO,
  locacaoRecebimentoSchema,
  orgContractDefaultsSchema,
  resolveOrgLocacaoRecebimento,
} from "../default-config";

describe("locacaoRecebimentoSchema", () => {
  it("aceita o shape completo com strings vazias (não informado)", () => {
    expect(locacaoRecebimentoSchema.safeParse(DEFAULT_LOCACAO_RECEBIMENTO).success).toBe(true);
  });

  it("é strict: campo desconhecido é recusado, não descartado em silêncio", () => {
    const r = locacaoRecebimentoSchema.safeParse({
      ...DEFAULT_LOCACAO_RECEBIMENTO,
      wallet_id: "abc",
    });
    expect(r.success).toBe(false);
  });

  it("enum de tipo de chave e de conta só aceita o domínio (ou vazio)", () => {
    expect(
      locacaoRecebimentoSchema.safeParse({ ...DEFAULT_LOCACAO_RECEBIMENTO, pix_tipo_chave: "RG" }).success
    ).toBe(false);
    expect(
      locacaoRecebimentoSchema.safeParse({ ...DEFAULT_LOCACAO_RECEBIMENTO, tipo_conta: "salario" }).success
    ).toBe(false);
    expect(
      locacaoRecebimentoSchema.safeParse({
        ...DEFAULT_LOCACAO_RECEBIMENTO,
        pix_tipo_chave: "CNPJ",
        tipo_conta: "poupanca",
      }).success
    ).toBe(true);
  });

  it("o branch é a unidade de salvamento: campo faltante é recusado, não mesclado", () => {
    // A rota PATCH mescla por BRANCH (`locacao_recebimento` inteiro), nunca
    // por campo — quem mandar só `pix_chave` esperando merge fino leva 400.
    const { pix_chave: _omitido, ...semPix } = DEFAULT_LOCACAO_RECEBIMENTO;
    expect(locacaoRecebimentoSchema.safeParse(semPix).success).toBe(false);
  });

  it("entra no envelope de contractDefaultsJson como branch opcional", () => {
    expect(orgContractDefaultsSchema.safeParse({}).success).toBe(true);
    expect(
      orgContractDefaultsSchema.safeParse({ locacao_recebimento: { pix_chave: "x" } }).success
    ).toBe(true);
  });
});

describe("resolveOrgLocacaoRecebimento", () => {
  it("sem row, sem branch ou JSON estranho → tudo vazio, nunca lança", () => {
    expect(resolveOrgLocacaoRecebimento(null)).toEqual(DEFAULT_LOCACAO_RECEBIMENTO);
    expect(resolveOrgLocacaoRecebimento({ locacao: { foro: "SP" } })).toEqual(DEFAULT_LOCACAO_RECEBIMENTO);
    expect(resolveOrgLocacaoRecebimento({ locacao_recebimento: "lixo" })).toEqual(
      DEFAULT_LOCACAO_RECEBIMENTO
    );
  });

  it("lê o que a org gravou e cai em '' no que não reconhece", () => {
    const r = resolveOrgLocacaoRecebimento({
      locacao_recebimento: {
        pix_chave: "64.524.938/0001-93",
        pix_tipo_chave: "CNPJ",
        banco: "Itaú BBA",
        agencia: "7307",
        conta: "96637",
        tipo_conta: "corrente",
        titular_nome: "Atrio Negócios Imobiliários Ltda",
        titular_doc: 123, // tipo errado → ""
        pix_tipo_chave_extra: "ignorado",
      },
    });
    expect(r).toEqual({
      pix_chave: "64.524.938/0001-93",
      pix_tipo_chave: "CNPJ",
      banco: "Itaú BBA",
      agencia: "7307",
      conta: "96637",
      tipo_conta: "corrente",
      titular_nome: "Atrio Negócios Imobiliários Ltda",
      titular_doc: "",
    });
    // Enum fora do domínio não vira via de pagamento inventada.
    expect(
      resolveOrgLocacaoRecebimento({ locacao_recebimento: { pix_tipo_chave: "RG", tipo_conta: "x" } })
    ).toMatchObject({ pix_tipo_chave: "", tipo_conta: "" });
  });
});
