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

  it("inclui corretora apenas com flag incluir_como_signatario + email", () => {
    const base = {
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "Vendedor",
          email: "v@x.com",
        },
      ],
      compradores: [],
      comissao: {
        imobiliaria_nome: "Imob Plus",
        imobiliaria_cnpj: "11.222.333/0001-44",
        imobiliaria_email: "imob@x.com",
        // sem flag → não inclui
      },
    };
    expect(dealDataToSigners(base).signers).toHaveLength(1);

    const withFlag = {
      ...base,
      comissao: { ...base.comissao, incluir_como_signatario: true },
    };
    const result = dealDataToSigners(withFlag);
    expect(result.signers).toHaveLength(2);
    const corretora = result.signers.find((s) => s.sourceKind === "corretora");
    expect(corretora).toBeDefined();
    expect(corretora?.email).toBe("imob@x.com");
    expect(corretora?.documentation).toBe("11222333000144");
  });

  it("inclui múltiplos comissionados marcados (fonte canônica)", () => {
    const result = dealDataToSigners({
      vendedores: [{ nome: "V", email: "v@x.com" }],
      compradores: [{ nome: "C", email: "c@x.com" }],
      comissao: {
        // legados ignorados quando comissionados[] tem itens
        imobiliaria_nome: "Legacy Imob",
        imobiliaria_email: "legacy@x.com",
        incluir_como_signatario: true,
        comissionados: [
          {
            nome: "Imob Principal",
            cnpj: "11.222.333/0001-44",
            tipo_pessoa: "juridica",
            email: "principal@x.com",
            incluir_como_signatario: true,
          },
          // sem flag → ignora
          {
            nome: "Sub Corretor PF",
            cpf: "111.222.333-44",
            email: "sub@x.com",
          },
          {
            nome: "Intermediária",
            cpf: "555.666.777-88",
            tipo_pessoa: "fisica",
            email: "inter@x.com",
            incluir_como_signatario: true,
          },
        ],
      },
    });
    const corretoras = result.signers.filter((s) => s.sourceKind === "corretora");
    expect(corretoras).toHaveLength(2);
    expect(corretoras[0]).toMatchObject({
      sourceIndex: 0,
      name: "Imob Principal",
      email: "principal@x.com",
      documentation: "11222333000144",
    });
    expect(corretoras[1]).toMatchObject({
      sourceIndex: 2,
      name: "Intermediária",
      email: "inter@x.com",
      documentation: "55566677788",
    });
  });

  it("comissionados[] vazio cai no fallback legacy imobiliaria_*", () => {
    const result = dealDataToSigners({
      vendedores: [{ nome: "V", email: "v@x.com" }],
      compradores: [{ nome: "C", email: "c@x.com" }],
      comissao: {
        imobiliaria_nome: "Imob Plus",
        imobiliaria_cnpj: "11.222.333/0001-44",
        imobiliaria_email: "imob@x.com",
        incluir_como_signatario: true,
        comissionados: [],
      },
    });
    const corretoras = result.signers.filter((s) => s.sourceKind === "corretora");
    expect(corretoras).toHaveLength(1);
    expect(corretoras[0]).toMatchObject({
      sourceIndex: 0,
      name: "Imob Plus",
      email: "imob@x.com",
      documentation: "11222333000144",
    });
  });

  it("inclui cônjuge como signer separado quando flag está marcada", () => {
    const result = dealDataToSigners({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "Odair",
          cpf: "111.222.333-44",
          email: "odair@x.com",
          conjuge: {
            nome: "Elenira",
            cpf: "555.666.777-88",
            email: "elenira@x.com",
            incluir_como_signatario: true,
          },
        },
      ],
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "Rosângela",
          cpf: "999.888.777-66",
          email: "rosangela@x.com",
          conjuge: {
            // sem flag → ignora cônjuge
            nome: "Flávio",
            email: "flavio@x.com",
          },
        },
      ],
    });
    expect(result.signers).toHaveLength(3);
    const conjugeVendedor = result.signers.find(
      (s) => s.sourceKind === "vendedor" && s.name === "Elenira"
    );
    expect(conjugeVendedor).toBeDefined();
    expect(conjugeVendedor?.sourceIndex).toBe(1000);
    expect(conjugeVendedor?.documentation).toBe("55566677788");
  });

  it("cônjuge sem email/nome não vira signer mesmo com flag", () => {
    const result = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          conjuge: { incluir_como_signatario: true },
        },
      ],
    });
    expect(result.signers).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
  });

  it("inclui apenas testemunhas marcadas com flag e dados completos", () => {
    const data = {
      vendedores: [{ nome: "V", email: "v@x.com" }],
      compradores: [],
      testemunhas: [
        // sem flag → ignora
        { nome: "T1", email: "t1@x.com" },
        // flag + dados completos → inclui
        {
          nome: "T2",
          cpf: "111.222.333-44",
          email: "t2@x.com",
          incluir_como_signatario: true,
        },
        // flag mas sem email → ignora
        { nome: "T3", incluir_como_signatario: true },
      ],
    };
    const result = dealDataToSigners(data);
    expect(result.signers).toHaveLength(2);
    const testemunhas = result.signers.filter(
      (s) => s.sourceKind === "testemunha"
    );
    expect(testemunhas).toHaveLength(1);
    expect(testemunhas[0]).toMatchObject({
      sourceKind: "testemunha",
      sourceIndex: 1,
      name: "T2",
      email: "t2@x.com",
      documentation: "11122233344",
    });
  });

  it("testemunhas e corretora sem email não geram entrada em missing", () => {
    const result = dealDataToSigners({
      vendedores: [{ nome: "V", email: "v@x.com" }],
      compradores: [{ nome: "C", email: "c@x.com" }],
      testemunhas: [{ nome: "T", incluir_como_signatario: true }],
      comissao: {
        imobiliaria_nome: "Imob",
        incluir_como_signatario: true,
      },
    });
    expect(result.missing).toHaveLength(0);
    expect(result.signers).toHaveLength(2); // só V + C
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
