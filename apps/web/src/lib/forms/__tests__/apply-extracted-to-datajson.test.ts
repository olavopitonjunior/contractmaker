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

  // Os kinds de sub-slot criados em 2026-07-31 precisam funcionar server-side
  // (rota admin `/attachments/[id]/apply`) sem mudança de código — o adaptador
  // de path cria o objeto aninhado sozinho.
  it("procurador_vendedor cria vendedores.0.procurador + tem_procurador", () => {
    const { merged, filled } = applyExtractedToDataJson(
      { vendedores: [{ nome: "João Vendedor", cpf: "55566677788" }] },
      {
        category: "procuracao",
        fields: {
          outorgante_nome: "João Vendedor",
          outorgante_cpf: "55566677788",
          outorgado_nome: "Carlos Procurador",
          outorgado_cpf: "99988877766",
        },
      },
      { kind: "procurador_vendedor", index: 0 }
    );
    expect(filled).toBeGreaterThan(0);
    const vendedor = (merged.vendedores as Array<Record<string, unknown>>)[0];
    const procurador = vendedor.procurador as Record<string, unknown>;
    expect(procurador.nome).toBe("Carlos Procurador");
    expect(procurador.cpf).toBe("99988877766");
    expect(vendedor.tem_procurador).toBe(true);
    // Titular intocado.
    expect(vendedor.nome).toBe("João Vendedor");
  });

  it("conjuge_locador (locação) cria locadores.0.conjuge + estado civil", () => {
    const { merged } = applyExtractedToDataJson(
      { locadores: [{ nome: "João Locador" }] },
      {
        category: "rg",
        fields: { nome_completo: "Joana Locadora", cpf_numero: "22233344455" },
      },
      { kind: "conjuge_locador", index: 0 },
      { kind: "locacao" }
    );
    const locador = (merged.locadores as Array<Record<string, unknown>>)[0];
    expect((locador.conjuge as Record<string, unknown>).nome).toBe("Joana Locadora");
    expect(locador.estado_civil).toBe("Casado(a)");
  });

  it("conjuge_fiador (locação) aninha em garantia.fiador.conjuge", () => {
    const { merged } = applyExtractedToDataJson(
      { garantia: { tipo: "fiador", fiador: { nome: "Pedro Fiador" } } },
      { category: "cnh", fields: { nome_completo: "Clara Fiadora" } },
      { kind: "conjuge_fiador", index: 0 },
      { kind: "locacao" }
    );
    const garantia = merged.garantia as Record<string, unknown>;
    const fiador = garantia.fiador as Record<string, unknown>;
    expect((fiador.conjuge as Record<string, unknown>).nome).toBe("Clara Fiadora");
    expect(fiador.estado_civil).toBe("Casado(a)");
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

// 2026-09-02 — paridade com a etapa 0: aplicar um doc ao fiador pelo servidor
// define a modalidade (e limpa a anterior), sem respeitar `skipIfDirty` para o
// `garantia.tipo` (que tem default "caucao" e chegaria "preenchido").
describe("applyExtractedToDataJson — doc no fiador vira a garantia para fiador (locação)", () => {
  it("fiador: tipo vira fiador, caução some, garantia.fiador recebe o OCR", () => {
    const { merged } = applyExtractedToDataJson(
      { garantia: { tipo: "caucao", caucao_meses: 3, provider: "" } },
      { category: "rg", fields: { nome_completo: "Pedro Fiador", cpf_numero: "11144477735" } },
      { kind: "fiador", index: 0 },
      { kind: "locacao" }
    );
    const garantia = merged.garantia as Record<string, unknown>;
    expect(garantia.tipo).toBe("fiador");
    expect(garantia.caucao_meses).toBe(0);
    expect((garantia.fiador as Record<string, unknown>).nome).toBe("Pedro Fiador");
  });

  it("conjuge_fiador também define a modalidade", () => {
    const { merged } = applyExtractedToDataJson(
      { garantia: { tipo: "seguro_fianca", cobertura_meses: 30, fiador: { nome: "Pedro" } } },
      { category: "cnh", fields: { nome_completo: "Clara Fiadora" } },
      { kind: "conjuge_fiador", index: 0 },
      { kind: "locacao" }
    );
    const garantia = merged.garantia as Record<string, unknown>;
    expect(garantia.tipo).toBe("fiador");
    expect(garantia.cobertura_meses).toBe(0);
    expect((garantia.fiador as Record<string, unknown>).nome).toBe("Pedro");
  });

  it("locatário não mexe na garantia; venda nunca", () => {
    const loc = applyExtractedToDataJson(
      { garantia: { tipo: "caucao", caucao_meses: 3 } },
      { category: "rg", fields: { nome_completo: "Lct" } },
      { kind: "locatario", index: 0 },
      { kind: "locacao" }
    );
    expect(loc.merged.garantia).toEqual({ tipo: "caucao", caucao_meses: 3 });

    const venda = applyExtractedToDataJson(
      { garantia: { tipo: "caucao" } },
      { category: "rg", fields: { nome_completo: "V" } },
      { kind: "vendedor", index: 0 }
    );
    expect(venda.merged.garantia).toEqual({ tipo: "caucao" });
  });
});
