import { describe, it, expect } from "vitest";
import { dealDataToSigners, isValidEmail } from "../mapping";

describe("dealDataToSigners", () => {
  it("retorna signers válidos e missing para partes sem email", () => {
    const data = {
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Silva",
          cpf: "123.456.789-00",
          email: "joao@example.com",
        },
        {
          tipo_pessoa: "fisica",
          nome: "Maria Souza",
          cpf: "987.654.321-00",
          // sem email
        },
      ],
      compradores: [
        {
          tipo_pessoa: "juridica",
          razao_social: "Imobiliária X Ltda",
          cnpj: "12.345.678/0001-90",
          email: "contato@imobx.com",
        },
      ],
    };
    const result = dealDataToSigners(data);
    expect(result.signers).toHaveLength(2);
    expect(result.missing).toHaveLength(1);

    const [v0, c0] = result.signers;
    expect(v0.sourceKind).toBe("vendedor");
    expect(v0.sourceIndex).toBe(0);
    expect(v0.documentation).toBe("12345678900"); // só dígitos
    expect(v0.authMethod).toBe("email");

    expect(c0.sourceKind).toBe("comprador");
    expect(c0.documentation).toBe("12345678000190");

    expect(result.missing[0]).toEqual({
      sourceKind: "vendedor",
      sourceIndex: 1,
      name: "Maria Souza",
    });
  });

  it("ignora partes sem nome", () => {
    const result = dealDataToSigners({
      vendedores: [{ email: "x@y.com" }],
    });
    expect(result.signers).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("aceita data vazia sem crash", () => {
    expect(dealDataToSigners(null).signers).toHaveLength(0);
    expect(dealDataToSigners(undefined).signers).toHaveLength(0);
    expect(dealDataToSigners({}).signers).toHaveLength(0);
  });
});

describe("isValidEmail", () => {
  it.each([
    ["foo@bar.com", true],
    ["user.name+tag@sub.domain.co", true],
    ["sem-arroba", false],
    ["sem@dominio", false],
    ["", false],
  ])("%s → %s", (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });
});
