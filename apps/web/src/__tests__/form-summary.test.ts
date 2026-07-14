import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";

const findSection = (secs: ReturnType<typeof buildConsolidatedFormSummary>, title: string) =>
  secs.find((s) => s.title.startsWith(title));

describe("buildConsolidatedFormSummary", () => {
  it("returns [] for non compra_venda schemas", () => {
    expect(buildConsolidatedFormSummary({ locador: [] }, { schemaType: "locacao_residencial_v1" })).toEqual([]);
  });

  it("returns [] for null/empty data", () => {
    expect(buildConsolidatedFormSummary(null)).toEqual([]);
    expect(buildConsolidatedFormSummary({})).toEqual([]);
  });

  it("builds party sections with formatted CPF/CNPJ and endereco", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Silva",
          cpf: "11122233344",
          rg: "12.345.678-9",
          estado_civil: "Casado(a)",
          email: "joao@ex.com",
          endereco: "Rua A",
          numero: "100",
          cidade: "São Paulo",
          uf: "SP",
          cep: "01234567",
          conjuge: { nome: "Maria Silva", cpf: "55566677788" },
        },
      ],
      compradores: [
        { tipo_pessoa: "juridica", razao_social: "Imob LTDA", cnpj: "11222333000144" },
      ],
    });

    const vend = findSection(secs, "Vendedor");
    expect(vend).toBeDefined();
    expect(vend!.rows).toContainEqual({ label: "CPF", value: "111.222.333-44" });
    expect(vend!.rows).toContainEqual({ label: "Cônjuge", value: "Maria Silva · CPF 555.666.777-88" });
    expect(vend!.rows.find((r) => r.label === "Endereço")!.value).toContain("Rua A, 100");
    expect(vend!.rows.find((r) => r.label === "Endereço")!.value).toContain("01234-567");

    const comp = findSection(secs, "Comprador");
    expect(comp!.rows).toContainEqual({ label: "Razão social", value: "Imob LTDA" });
    expect(comp!.rows).toContainEqual({ label: "CNPJ", value: "11.222.333/0001-44" });
  });

  it("builds imovel and parcelas sections", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X" }],
      imoveis: [{ rua: "Av B", numero: "50", cidade: "Rio", uf: "RJ", matricula: "9999", descricao: "Apartamento 2 quartos" }],
      pagamento: { valor_total: 500000, parcelas: [{ valor: 50000, tipo_texto: "Sinal", momento: "assinatura" }] },
    });
    const imv = findSection(secs, "Imóvel");
    expect(imv!.rows).toContainEqual({ label: "Matrícula", value: "9999" });
    const parc = findSection(secs, "Parcelas");
    expect(parc).toBeDefined();
    expect(parc!.rows[0].label).toBe("Parcela 1");
    expect(parc!.rows[0].value).toContain("R$ 50.000,00");
  });

  it("lists attachments when provided", () => {
    const secs = buildConsolidatedFormSummary(
      { vendedores: [{ tipo_pessoa: "fisica", nome: "X" }] },
      { attachments: [{ filename: "rg.pdf", category: "rg" }] }
    );
    const docs = findSection(secs, "Documentos anexados");
    expect(docs!.rows).toContainEqual({ label: "RG", value: "rg.pdf" });
  });
});
