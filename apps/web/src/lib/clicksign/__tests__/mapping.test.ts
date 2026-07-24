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
          // PJ assina pelo representante legal (PF com CPF) — a ClickSign
          // rejeita CNPJ como documentação de signer.
          representante: {
            nome: "Rep Legal",
            cpf: "111.222.333-44",
            email: "contato@imobx.com",
          },
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
    expect(c0.subKind).toBe("representante");
    expect(c0.documentation).toBe("11122233344"); // CPF do representante

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

  it("inclui cônjuge como signer separado — com e sem a flag (opt-out)", () => {
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
            // Sem a flag: entra assim mesmo. Nenhuma UI do formulário público
            // seta `incluir_como_signatario`, e o cônjuge já assina no PDF.
            nome: "Flávio",
            email: "flavio@x.com",
          },
        },
      ],
    });
    expect(result.signers).toHaveLength(4);
    const conjugeVendedor = result.signers.find(
      (s) => s.sourceKind === "vendedor" && s.name === "Elenira"
    );
    expect(conjugeVendedor).toBeDefined();
    // Cônjuge agora usa o MESMO sourceIndex do titular + subKind="conjuge"
    // (desambigua o override de papel da UI; sem +1000 mágico).
    expect(conjugeVendedor?.sourceIndex).toBe(0);
    expect(conjugeVendedor?.subKind).toBe("conjuge");
    expect(conjugeVendedor?.documentation).toBe("55566677788");

    const conjugeComprador = result.signers.find(
      (s) => s.sourceKind === "comprador" && s.name === "Flávio"
    );
    expect(conjugeComprador?.subKind).toBe("conjuge");
  });

  it("cônjuge com incluir_como_signatario: false fica de fora", () => {
    const result = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          conjuge: {
            nome: "Removida na popup",
            email: "removida@x.com",
            incluir_como_signatario: false,
          },
        },
      ],
    });
    expect(result.signers).toHaveLength(1);
    expect(result.signers[0].subKind).toBe("titular");
    expect(result.missing).toHaveLength(0);
  });

  it("cônjuge sem email/nome não vira signer nem entra em missing", () => {
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
    // `missing` bloqueia o envelope inteiro — cônjuge incompleto só é omitido.
    expect(result.missing).toHaveLength(0);
  });

  it("procurador entra sem a flag e sai com flag false", () => {
    const comProcurador = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          tem_procurador: true,
          procurador: {
            nome: "Procurador Fulano",
            cpf: "555.666.777-88",
            email: "proc@x.com",
          },
        },
      ],
    });
    expect(comProcurador.signers).toHaveLength(2);
    const proc = comProcurador.signers.find((s) => s.subKind === "procurador");
    expect(proc).toMatchObject({
      name: "Procurador Fulano",
      email: "proc@x.com",
      documentation: "55566677788",
      sourceIndex: 0,
    });

    const semProcurador = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          procurador: {
            nome: "Procurador Fulano",
            email: "proc@x.com",
            incluir_como_signatario: false,
          },
        },
      ],
    });
    expect(semProcurador.signers).toHaveLength(1);
  });

  it("ex-cônjuge não assina quando o estado civil deixou de ser casado", () => {
    // O form esconde o bloco ao trocar pra "Divorciado(a)", mas NÃO apaga o
    // sub-objeto do dataJson.
    const result = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          estado_civil: "Divorciado(a)",
          conjuge: { nome: "Ex", email: "ex@x.com" },
        },
      ],
    });
    expect(result.signers).toHaveLength(1);
  });

  it("estado civil ausente ou em variante do OCR não derruba a outorga", () => {
    // O gate é leniente: só exclui quem DECLAROU não ter cônjuge. Um dataJson
    // legado (sem estado_civil) ou vindo do OCR ("União estável" minúsculo,
    // como o prompt do Gemini pede) mantém o cônjuge assinando.
    for (const estado_civil of [undefined, "União estável", "Uniao Estavel"]) {
      const result = dealDataToSigners({
        vendedores: [
          {
            nome: "V",
            email: "v@x.com",
            estado_civil,
            conjuge: { nome: "Companheira", email: "c@x.com" },
          },
        ],
      });
      expect(
        result.signers.some((s) => s.subKind === "conjuge"),
        String(estado_civil)
      ).toBe(true);
    }
  });

  it("procurador descartado (tem_procurador: false) não assina", () => {
    // Desmarcar "Possui procurador" esconde os campos mas mantém o objeto —
    // sem o guard, um terceiro descartado receberia o CCV real pra assinar.
    const result = dealDataToSigners({
      vendedores: [
        {
          nome: "V",
          email: "v@x.com",
          tem_procurador: false,
          procurador: { nome: "Descartado", email: "desc@x.com" },
        },
      ],
    });
    expect(result.signers).toHaveLength(1);
  });

  it("não duplica signatário quando o cônjuge também é parte autônoma", () => {
    const result = dealDataToSigners({
      vendedores: [
        {
          nome: "Odair",
          email: "odair@x.com",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Elenira", email: "ELENIRA@x.com" },
        },
        { nome: "Elenira", email: "elenira@x.com" },
      ],
    });
    // Titular 0, titular 1 — e o cônjuge suprimido por e-mail repetido
    // (comparação case-insensitive).
    expect(result.signers).toHaveLength(2);
    expect(result.signers.some((s) => s.subKind === "conjuge")).toBe(false);
  });

  it("PJ ignora cônjuge e procurador sujos no dataJson", () => {
    const result = dealDataToSigners({
      vendedores: [
        {
          tipo_pessoa: "juridica",
          razao_social: "Empresa X",
          cnpj: "11.222.333/0001-44",
          representante: { nome: "Rep Legal", cpf: "111.222.333-44", email: "rep@x.com" },
          conjuge: { nome: "Não deveria assinar", email: "nao@x.com" },
          procurador: { nome: "Nem esse", email: "nem@x.com" },
        },
      ],
    });
    expect(result.signers).toHaveLength(1);
    expect(result.signers[0].subKind).toBe("representante");
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
