import { describe, it, expect } from "vitest";
import { applyExtractedToDataJson } from "../apply-extracted-to-datajson";

describe("applyExtractedToDataJson", () => {
  it("preenche vendedores.0 a partir de um RG (pessoa)", () => {
    const { merged, filled } = applyExtractedToDataJson(
      {},
      {
        category: "rg",
        fields: {
          nome_completo: "João Silva",
          cpf_numero: "12345678901",
          rg_numero: "1234567",
        },
      },
      { kind: "vendedor", index: 0 }
    );
    expect(filled).toBeGreaterThan(0);
    const vendedores = (merged.vendedores as Array<Record<string, unknown>>);
    expect(vendedores[0].nome).toBe("João Silva");
    expect(vendedores[0].cpf).toBe("12345678901");
    expect(vendedores[0].rg).toBe("1234567");
  });

  it("respeita skipIfDirty — não sobrescreve campo já preenchido", () => {
    const { merged } = applyExtractedToDataJson(
      { vendedores: [{ nome: "Nome Existente" }] },
      { category: "rg", fields: { nome_completo: "OCR Nome", cpf_numero: "12345678901" } },
      { kind: "vendedor", index: 0 },
      { skipIfDirty: true }
    );
    const vendedores = merged.vendedores as Array<Record<string, unknown>>;
    expect(vendedores[0].nome).toBe("Nome Existente"); // preservado
    expect(vendedores[0].cpf).toBe("12345678901"); // preenchido (estava vazio)
  });

  it("preenche imoveis.0 a partir de uma matrícula (imóvel)", () => {
    const { merged } = applyExtractedToDataJson(
      {},
      {
        category: "matricula",
        fields: { matricula_numero: "98765", cartorio: "1º RI" },
      },
      { kind: "imovel", index: 0 }
    );
    const imoveis = merged.imoveis as Array<Record<string, unknown>>;
    expect(imoveis[0].matricula).toBe("98765");
    expect(imoveis[0].cartorio).toBe("1º RI");
  });

  it("kind 'outro' não preenche nada", () => {
    const { merged, filled } = applyExtractedToDataJson(
      {},
      { category: "rg", fields: { nome_completo: "Fulano" } },
      { kind: "outro", index: 0 }
    );
    expect(filled).toBe(0);
    expect(merged.vendedores).toBeUndefined();
  });

  it("preserva chaves intactas do dataJson (ex: pagamento)", () => {
    const { merged } = applyExtractedToDataJson(
      { pagamento: { valor_total: 500000 } },
      { category: "rg", fields: { nome_completo: "João", cpf_numero: "12345678901" } },
      { kind: "comprador", index: 0 }
    );
    expect((merged.pagamento as { valor_total: number }).valor_total).toBe(500000);
    expect((merged.compradores as Array<Record<string, unknown>>)[0].nome).toBe("João");
  });

  it("não muta o dataJson original", () => {
    const original = { vendedores: [{ nome: "X" }] };
    applyExtractedToDataJson(
      original,
      { category: "rg", fields: { cpf_numero: "12345678901" } },
      { kind: "vendedor", index: 0 }
    );
    expect(original.vendedores[0]).not.toHaveProperty("cpf");
  });
});
