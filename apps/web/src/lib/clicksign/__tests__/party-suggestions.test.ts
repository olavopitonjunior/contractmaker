import { describe, it, expect } from "vitest";
import { buildPartySuggestions } from "../party-suggestions";

describe("buildPartySuggestions", () => {
  it("PF casada com procurador rende titular + cônjuge + procurador", () => {
    const out = buildPartySuggestions(
      [
        {
          tipo_pessoa: "fisica",
          nome: "Odair Vendedor",
          cpf: "111.444.777-35",
          email: "odair@x.com",
          mobile_phone: "(11) 99999-0000",
          conjuge: {
            nome: "Elenira",
            cpf: "529.982.247-25",
            email: "elenira@x.com",
            mobile_phone: "(11) 98888-0000",
          },
          procurador: { nome: "Procurador Fulano", cpf: "222.333.444-05" },
        },
      ],
      []
    );

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      subKind: "titular",
      name: "Odair Vendedor",
      email: "odair@x.com",
      documentation: "11144477735",
      phone: "11999990000",
      role: "seller",
      subLabel: null,
    });
    expect(out[1]).toMatchObject({
      subKind: "conjuge",
      name: "Elenira",
      email: "elenira@x.com",
      documentation: "52998224725",
      // Cônjuge assina como Anuente.
      role: "consenting",
      label: "Elenira (cônjuge)",
      subLabel: "cônjuge",
    });
    expect(out[2]).toMatchObject({
      subKind: "procurador",
      role: "attorney",
      // Sem e-mail no form → null, e não string vazia.
      email: null,
    });
    // Todos compartilham o sourceIndex do titular.
    expect(out.every((s) => s.sourceIndex === 0)).toBe(true);
  });

  it("PJ rende só o representante, com e-mail e CPF dele", () => {
    const out = buildPartySuggestions(
      [
        {
          tipo_pessoa: "juridica",
          razao_social: "Patrimonial Ltda",
          cnpj: "11.222.333/0001-44",
          representante: {
            nome: "Ana Representante",
            cpf: "111.444.777-35",
            email: "ana@empresa.com",
          },
        },
      ],
      []
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      subKind: "representante",
      name: "Ana Representante",
      // O schema de PJ não tem `email` — antes o chip saía vazio.
      email: "ana@empresa.com",
      documentation: "11144477735",
      // Representante assina NO LUGAR da parte → herda o papel dela.
      role: "seller",
      subLabel: "representante",
    });
  });

  it("PJ sem representante cai na razão social e no CNPJ", () => {
    const out = buildPartySuggestions(
      [
        {
          tipo_pessoa: "juridica",
          razao_social: "Patrimonial Ltda",
          cnpj: "11.222.333/0001-44",
        },
      ],
      []
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "Patrimonial Ltda",
      email: null,
      documentation: "11222333000144",
    });
  });

  it("comprador usa os papéis do lado comprador e preserva o índice", () => {
    const out = buildPartySuggestions(
      [],
      [
        { tipo_pessoa: "fisica", nome: "Primeiro" },
        {
          tipo_pessoa: "fisica",
          nome: "Segundo",
          conjuge: { nome: "Cônjuge do Segundo" },
        },
      ]
    );

    expect(out.map((s) => [s.sourceKind, s.sourceIndex, s.subKind, s.role])).toEqual([
      ["comprador", 0, "titular", "buyer"],
      ["comprador", 1, "titular", "buyer"],
      ["comprador", 1, "conjuge", "consenting"],
    ]);
  });

  it("ignora partes e sub-partes sem nome", () => {
    const out = buildPartySuggestions(
      [
        { tipo_pessoa: "fisica", nome: "  ", email: "vazio@x.com" },
        { tipo_pessoa: "fisica", nome: "Válido", conjuge: { email: "sonome@x.com" } },
      ],
      undefined
    );

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Válido");
  });
});
