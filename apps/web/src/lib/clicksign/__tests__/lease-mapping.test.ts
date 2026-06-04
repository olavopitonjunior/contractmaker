import { describe, it, expect } from "vitest";
import { leaseDataToSigners, dealDataToSigners } from "../mapping";

describe("leaseDataToSigners", () => {
  it("mapeia locador e locatário PF por default", () => {
    const { signers, missing } = leaseDataToSigners({
      locadores: [
        {
          tipo_pessoa: "fisica",
          nome: "Ana Locadora",
          cpf: "111.444.777-35",
          email: "ana@example.com",
          mobile_phone: "(11) 99999-0000",
        },
      ],
      locatarios: [
        {
          tipo_pessoa: "fisica",
          nome: "Bruno Locatário",
          cpf: "222.333.444-05",
          email: "bruno@example.com",
        },
      ],
    });

    expect(missing).toHaveLength(0);
    expect(signers).toHaveLength(2);
    expect(signers[0]).toMatchObject({
      sourceKind: "locador",
      sourceIndex: 0,
      name: "Ana Locadora",
      email: "ana@example.com",
      documentation: "11144477735",
      phone: "11999990000",
    });
    expect(signers[1]).toMatchObject({
      sourceKind: "locatario",
      name: "Bruno Locatário",
    });
  });

  it("usa o representante como signatário quando a parte é PJ", () => {
    const { signers, missing } = leaseDataToSigners({
      locadores: [
        {
          tipo_pessoa: "juridica",
          razao_social: "Imobiliária XPTO Ltda",
          cnpj: "11.222.333/0001-81",
          representante: {
            nome: "Carla Representante",
            cpf: "333.222.111-00",
            email: "carla@xpto.com",
            mobile_phone: "11988887777",
          },
        },
      ],
      locatarios: [],
    });

    expect(missing).toHaveLength(0);
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({
      sourceKind: "locador",
      name: "Carla Representante",
      email: "carla@xpto.com",
      documentation: "33322211100",
      phone: "11988887777",
    });
  });

  it("registra missing quando o titular não tem e-mail", () => {
    const { signers, missing } = leaseDataToSigners({
      locadores: [{ tipo_pessoa: "fisica", nome: "Sem Email", cpf: "1" }],
      locatarios: [
        {
          tipo_pessoa: "fisica",
          nome: "Com Email",
          email: "ok@example.com",
        },
      ],
    });

    expect(signers).toHaveLength(1);
    expect(missing).toEqual([
      { sourceKind: "locador", sourceIndex: 0, name: "Sem Email" },
    ]);
  });

  it("respeita incluir_como_signatario=false (opt-out)", () => {
    const { signers } = leaseDataToSigners({
      locadores: [
        {
          tipo_pessoa: "fisica",
          nome: "Fora",
          email: "fora@example.com",
          incluir_como_signatario: false,
        },
      ],
      locatarios: [],
    });
    expect(signers).toHaveLength(0);
  });

  it("inclui o fiador só quando a garantia é fiador", () => {
    const base = {
      locadores: [
        { tipo_pessoa: "fisica" as const, nome: "L", email: "l@example.com" },
      ],
      locatarios: [
        { tipo_pessoa: "fisica" as const, nome: "T", email: "t@example.com" },
      ],
    };

    const semFiador = leaseDataToSigners({
      ...base,
      garantia: { tipo: "caucao" },
    });
    expect(semFiador.signers.find((s) => s.sourceKind === "fiador")).toBeUndefined();

    const comFiador = leaseDataToSigners({
      ...base,
      garantia: {
        tipo: "fiador",
        fiador: {
          tipo_pessoa: "fisica",
          nome: "Fernando Fiador",
          cpf: "444.555.666-77",
          email: "fernando@example.com",
        },
      },
    });
    const fiadorSigner = comFiador.signers.find((s) => s.sourceKind === "fiador");
    expect(fiadorSigner).toMatchObject({
      sourceKind: "fiador",
      name: "Fernando Fiador",
      email: "fernando@example.com",
    });
  });

  it("não confunde com o mapeamento de venda (dataJson de venda → 0 signers de locação)", () => {
    const vendaData = {
      vendedores: [{ tipo_pessoa: "fisica", nome: "V", email: "v@example.com" }],
      compradores: [{ tipo_pessoa: "fisica", nome: "C", email: "c@example.com" }],
    };
    // leaseDataToSigners ignora as chaves de venda...
    expect(leaseDataToSigners(vendaData).signers).toHaveLength(0);
    // ...e dealDataToSigners continua mapeando venda normalmente.
    expect(dealDataToSigners(vendaData).signers).toHaveLength(2);
  });
});
