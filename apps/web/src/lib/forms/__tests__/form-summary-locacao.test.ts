import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "../form-summary";

/**
 * Resumo consolidado de LOCAÇÃO (1.4 do plano 2026-08-06). O builder de venda
 * já tem cobertura via negotiation-summary; aqui garantimos que os dois
 * schemas de locação produzem seções (antes retornavam []) e que o de venda
 * segue intacto.
 */

const LOCACAO_DATA = {
  locadores: [
    {
      tipo_pessoa: "fisica",
      nome: "Carlos Locador",
      cpf: "39053344705",
      estado_civil: "Solteiro(a)",
      email: "carlos@ex.com",
    },
  ],
  locatarios: [
    {
      tipo_pessoa: "fisica",
      nome: "Lívia Locatária",
      cpf: "52998224725",
      renda_mensal: 12000,
    },
  ],
  imovel: {
    rua: "Rua das Palmeiras",
    numero: "45",
    cidade: "Curitiba",
    uf: "PR",
    kind: "apartamento",
    area: 70,
    vagas_garagem: 1,
    condominio_nome: "Ed. Aurora",
    descricao: "Apartamento 2 quartos com sacada",
  },
  aluguel: {
    valor: 3200,
    encargos: 650,
    condominio_mensal: 450,
    iptu_mensal: 200,
    dia_vencimento: 10,
    indice_reajuste: "IGPM",
    vigencia_inicio: "2026-09-01",
    vigencia_meses: 30,
    meio_pagamento: "pix",
  },
  garantia: {
    tipo: "fiador",
    fiador: {
      tipo_pessoa: "fisica",
      nome: "Fábio Fiador",
      cpf: "11144477735",
      endereco: "Rua B",
      cidade: "Curitiba",
      uf: "PR",
    },
  },
  foro: "Curitiba/PR",
  observacoes: "Aceita um animal de pequeno porte.",
};

describe("buildConsolidatedFormSummary — locação", () => {
  it("residencial produz seções de partes, imóvel, aluguel, garantia e observações", () => {
    const sections = buildConsolidatedFormSummary(LOCACAO_DATA, {
      schemaType: "locacao_residencial_v1",
      attachments: [{ filename: "rg.pdf", category: "rg" }],
    });
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Locador"),
        expect.stringContaining("Locatária"),
        "Imóvel",
        "Aluguel e reajuste",
        "Garantia locatícia",
        expect.stringContaining("Fiador"),
        "Configuração contratual",
        "Observações gerais",
        "Documentos anexados",
      ])
    );

    const aluguel = sections.find((s) => s.title === "Aluguel e reajuste")!;
    const rows = Object.fromEntries(aluguel.rows.map((r) => [r.label, r.value]));
    expect(rows["Aluguel mensal"]).toContain("3.200,00");
    expect(rows["Vencimento"]).toBe("Dia 10");
    expect(rows["Vigência"]).toBe("30 meses");
    expect(rows["Início da vigência"]).toBe("01/09/2026");

    const locataria = sections.find((s) => s.title.includes("Locatária"))!;
    expect(
      locataria.rows.some(
        (r) => r.label === "Renda mensal declarada" && r.value.includes("12.000,00")
      )
    ).toBe(true);

    const garantia = sections.find((s) => s.title === "Garantia locatícia")!;
    expect(garantia.rows[0]).toEqual({ label: "Modalidade", value: "Fiador" });
  });

  it("comercial usa o mesmo builder (com destinação)", () => {
    const sections = buildConsolidatedFormSummary(
      {
        ...LOCACAO_DATA,
        imovel: { ...LOCACAO_DATA.imovel, destinacao: "Cafeteria" },
        garantia: { tipo: "caucao", caucao_meses: 3 },
      },
      { schemaType: "locacao_comercial_v1" }
    );
    const imovel = sections.find((s) => s.title === "Imóvel")!;
    expect(imovel.rows.some((r) => r.label === "Destinação" && r.value === "Cafeteria")).toBe(
      true
    );
    const garantia = sections.find((s) => s.title === "Garantia locatícia")!;
    expect(garantia.rows).toEqual([
      { label: "Modalidade", value: "Caução" },
      { label: "Caução", value: "3 aluguéis" },
    ]);
  });

  it("dataJson vazio de locação devolve [] (nada de PDF em branco)", () => {
    expect(
      buildConsolidatedFormSummary({}, { schemaType: "locacao_residencial_v1" })
    ).toEqual([]);
    expect(
      buildConsolidatedFormSummary(null, { schemaType: "locacao_residencial_v1" })
    ).toEqual([]);
  });

  it("schemaType desconhecido segue retornando []", () => {
    expect(
      buildConsolidatedFormSummary(LOCACAO_DATA, { schemaType: "outro_schema" })
    ).toEqual([]);
  });

  it("venda segue produzindo o resumo de sempre", () => {
    const sections = buildConsolidatedFormSummary(
      {
        vendedores: [{ tipo_pessoa: "fisica", nome: "V", cpf: "39053344705" }],
        compradores: [{ tipo_pessoa: "fisica", nome: "C" }],
        observacoes: "Obs de venda.",
      },
      { schemaType: "compra_venda_v1" }
    );
    expect(sections.some((s) => s.title === "Observações gerais")).toBe(true);
  });
});
