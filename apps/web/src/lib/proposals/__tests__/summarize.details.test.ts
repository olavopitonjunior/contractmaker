import { describe, it, expect } from "vitest";
import {
  summarizeProposalData,
  summarizeProposalDetails,
} from "@/lib/proposals/summarize";

describe("summarizeProposalData — seleção de partes por kind", () => {
  it("locação com compradores:[] legado não esconde o locatário", () => {
    const r = summarizeProposalData(
      { compradores: [], locatarios: [{ nome: "João" }] },
      "locacao"
    );
    expect(r.proponente).toBe("João");
  });

  it("sem kind mantém o fallback compradores ?? locatarios", () => {
    const r = summarizeProposalData({ locatarios: [{ nome: "João" }] });
    expect(r.proponente).toBe("João");
  });
});

describe("summarizeProposalDetails", () => {
  it("venda com financiamento: partes completas, modalidade, sinal, comissão e corretor", () => {
    const d = summarizeProposalDetails(
      {
        compradores: [
          {
            tipo_pessoa: "fisica",
            nome: "Maria Silva",
            cpf: "12345678900",
            email: "maria@x.com",
            telefone: "+5511987654321",
          },
        ],
        vendedores: [
          { tipo_pessoa: "juridica", nome: "Imob X", razao_social: "Imob X LTDA", cnpj: "12345678000199" },
        ],
        modalidade: "financiamento",
        pagamento: {
          valor_total: 500000,
          sinal_arras: 50000,
          forma: "Financiamento bancário (Itaú)",
          banco_financiamento: "Itaú",
        },
        comissao: { percentual: 6, valor: 30000, responsavel_pagamento: "vendedor" },
        corretor: { nome: "Ana", creci: "12345" },
        observacoes: "Entrega em 30 dias.",
      },
      "venda"
    );

    expect(d.proponentes).toEqual([
      {
        nome: "Maria Silva",
        doc: "CPF 123.456.789-00",
        contato: "maria@x.com · +5511987654321",
      },
    ]);
    // PJ: razão social vence o nome e o doc é CNPJ mascarado.
    expect(d.vendedores[0].nome).toBe("Imob X LTDA");
    expect(d.vendedores[0].doc).toBe("CNPJ 12.345.678/0001-99");
    expect(d.condicoes).toEqual([
      { label: "Modalidade", value: "Financiamento bancário (Itaú)" },
      { label: "Sinal", value: "R$ 50.000,00" },
    ]);
    expect(d.comissao).toEqual([
      { label: "Percentual", value: "6%" },
      { label: "Valor", value: "R$ 30.000,00" },
      { label: "Quem paga", value: "Vendedor" },
    ]);
    expect(d.corretorLabel).toBe("Ana (CRECI 12345)");
    expect(d.observacoes).toBe("Entrega em 30 dias.");
  });

  it("locação: prazo, entrada (data reordenada sem ICU), finalidade e garantia", () => {
    const d = summarizeProposalDetails(
      {
        locatarios: [{ nome: "João" }],
        locadores: [],
        locacao: {
          valor_aluguel: 3500,
          prazo_meses: 30,
          data_entrada: "2026-09-01",
          finalidade: "Residencial",
          garantia: "Caução (3 aluguéis)",
        },
      },
      "locacao"
    );
    expect(d.condicoes).toEqual([
      { label: "Prazo", value: "30 meses" },
      { label: "Entrada", value: "01/09/2026" },
      { label: "Finalidade", value: "Residencial" },
      { label: "Garantia", value: "Caução (3 aluguéis)" },
    ]);
    expect(d.proponentes).toEqual([{ nome: "João", doc: null, contato: null }]);
    expect(d.comissao).toEqual([]);
    expect(d.corretorLabel).toBeNull();
  });

  it("locação sem locacao.garantia usa o label do shape canônico garantia.tipo", () => {
    const d = summarizeProposalDetails(
      { locatarios: [], garantia: { tipo: "seguro_fianca" }, locacao: {} },
      "locacao"
    );
    expect(d.condicoes).toEqual([{ label: "Garantia", value: "Seguro fiança" }]);
  });

  it("dataJson vazio: tudo null/vazio, sem lançar", () => {
    const d = summarizeProposalDetails(null, "venda");
    expect(d.proponentes).toEqual([]);
    expect(d.vendedores).toEqual([]);
    expect(d.condicoes).toEqual([]);
    expect(d.comissao).toEqual([]);
    expect(d.corretorLabel).toBeNull();
    expect(d.observacoes).toBeNull();
  });

  it("percentual quebrado formata com vírgula", () => {
    const d = summarizeProposalDetails({ comissao: { percentual: 5.5 } }, "venda");
    expect(d.comissao).toEqual([{ label: "Percentual", value: "5,5%" }]);
  });
});
