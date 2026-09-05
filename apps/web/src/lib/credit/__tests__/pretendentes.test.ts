import { describe, it, expect } from "vitest";
import { derivePretendentes, tipoImovelForSchema, pretendentesIncompletos } from "../pretendentes";
import { applyProposalExtractions } from "@/lib/proposals/apply-extractions";

const CPF_OK = "52998224725";
const CNPJ_OK = "11222333000181";

describe("derivePretendentes — quem é consultado na análise de crédito da locação", () => {
  it("1 locatário PF completo → INQUILINO sem pendências", () => {
    const list = derivePretendentes({
      locatarios: [{ tipo_pessoa: "fisica", nome: "Maria", cpf: CPF_OK, data_nascimento: "1990-05-10" }],
      garantia: { tipo: "caucao" },
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "locatario",
      index: 0,
      basePath: "locatarios.0",
      label: "Locatário",
      tipoPretendente: "INQUILINO",
      pessoa: "fisica",
      residir: true,
      missing: [],
    });
  });

  it("casal + fiador com cônjuge → 4 pretendentes na ordem estável, cônjuge sem CPF válido pendente", () => {
    const list = derivePretendentes({
      locatarios: [
        { nome: "Maria", cpf: CPF_OK, data_nascimento: "1990-05-10", conjuge: { nome: "João", cpf: "111" } },
      ],
      garantia: {
        tipo: "fiador",
        fiador: { nome: "Fernando", cpf: "11144477735", data_nascimento: "1985-03-15", conjuge: { nome: "Helena" } },
      },
    });
    expect(list.map((p) => `${p.kind}:${p.index}`)).toEqual([
      "locatario:0",
      "conjuge_locatario:0",
      "fiador:0",
      "conjuge_fiador:0",
    ]);
    expect(list[1]).toMatchObject({ tipoPretendente: "CONJUGE_INQUILINO", basePath: "locatarios.0.conjuge" });
    expect(list[1].missing).toEqual(["cpf", "data_nascimento"]);
    expect(list[2]).toMatchObject({ tipoPretendente: "FIADOR", basePath: "garantia.fiador", residir: false });
    expect(list[3]).toMatchObject({ tipoPretendente: "CONJUGE_FIADOR", basePath: "garantia.fiador.conjuge" });
    expect(pretendentesIncompletos(list).map((p) => p.kind)).toEqual(["conjuge_locatario", "conjuge_fiador"]);
  });

  it("garantia caução com fiador residual no dataJson → fiador NÃO entra", () => {
    const list = derivePretendentes({
      locatarios: [{ nome: "Maria", cpf: CPF_OK }],
      garantia: { tipo: "caucao", fiador: { nome: "Fernando", cpf: "11144477735" } },
    });
    expect(list.map((p) => p.kind)).toEqual(["locatario"]);
  });

  it("locatário PJ → OUTROS com razão social; CNPJ inválido é pendência", () => {
    const list = derivePretendentes({
      locatarios: [
        { tipo_pessoa: "juridica", razao_social: "ACME Ltda", nome: "ACME Ltda", cnpj: CNPJ_OK },
        { tipo_pessoa: "juridica", razao_social: "Beta", cnpj: "123" },
      ],
    });
    expect(list[0]).toMatchObject({ pessoa: "juridica", tipoPretendente: "OUTROS", razaoSocial: "ACME Ltda", label: "Locatário 1", missing: [] });
    expect(list[1].missing).toEqual(["cnpj"]);
  });

  it("renda/origem/endereço lidos com tolerância (string com vírgula, código como string)", () => {
    const [p] = derivePretendentes({
      locatarios: [
        {
          nome: "Maria",
          cpf: CPF_OK,
          data_nascimento: "10/05/1990",
          renda_mensal: "3.500,00",
          renda_origem: "11",
          renda_outra_valor: 500,
          renda_outra_origem: 7,
          cep: "80.000-000",
          endereco: "Rua A",
          cidade: "Curitiba",
          uf: "pr",
          residir: false,
        },
      ],
    });
    expect(p.rendaMensal).toBe(3500);
    expect(p.rendaOrigem).toBe(11);
    expect(p.rendaOutraValor).toBe(500);
    expect(p.rendaOutraOrigem).toBe(7);
    expect(p.endereco).toMatchObject({ cep: "80000000", logradouro: "Rua A", cidade: "Curitiba", uf: "PR" });
    expect(p.residir).toBe(false);
  });

  it("dataJson vazio ou sem locatários → lista vazia", () => {
    expect(derivePretendentes({})).toEqual([]);
    expect(derivePretendentes(null)).toEqual([]);
  });

  it("composição da tela: OCR do RG (atribuição humana) preenche o nascimento antes de derivar — pendência some", () => {
    const data = { locatarios: [{ nome: "Maria", cpf: CPF_OK }] };
    const attachments = [
      {
        id: "a1",
        status: "ready",
        createdAt: "2026-09-04T10:00:00.000Z",
        extractedData: {
          category: "rg",
          fields: { nome_completo: "Maria", cpf_numero: CPF_OK, data_nascimento: "1990-05-10" },
          assignment: { kind: "locatario", index: 0 },
          assignmentPersisted: true,
        },
      },
    ];
    expect(derivePretendentes(data)[0].missing).toEqual(["data_nascimento"]);
    const merged = applyProposalExtractions(data, attachments, "locacao").merged;
    const [p] = derivePretendentes(merged);
    expect(p.dataNascimento).toBe("1990-05-10");
    expect(p.missing).toEqual([]);
  });

  it("tipoImovelForSchema: comercial → NAO_RESIDENCIAL, resto RESIDENCIAL", () => {
    expect(tipoImovelForSchema("locacao_comercial_v1")).toBe("NAO_RESIDENCIAL");
    expect(tipoImovelForSchema("locacao_residencial_v1")).toBe("RESIDENCIAL");
    expect(tipoImovelForSchema(null)).toBe("RESIDENCIAL");
  });
});
