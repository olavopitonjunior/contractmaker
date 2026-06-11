import { describe, it, expect } from "vitest";
import { buildNegotiationSummary } from "../negotiation-summary";

describe("buildNegotiationSummary", () => {
  it("retorna vazio sem dados", () => {
    expect(buildNegotiationSummary(null)).toEqual([]);
    expect(buildNegotiationSummary({})).toEqual([]);
  });

  it("deriva pagamento, comissão e condições do form", () => {
    const sections = buildNegotiationSummary({
      modalidade: "financiamento",
      pagamento: {
        valor_total: 350000,
        sinal_arras: 35000,
        alienacao_fiduciaria: 280000,
        fgts: 20000,
        parcelas: [{ valor: 1 }, { valor: 2 }],
      },
      comissao: {
        valor: 21000,
        percentual: 6,
        quem_paga_texto: "Parte Vendedora",
        quando_paga_texto: "na assinatura",
        comissionados: [{ nome: "A" }, { nome: "B" }],
      },
      debitos: { iptu: { selecionado: true, valor: 1200 } },
      vicios: { opcao: "reparar", descricao_reparar: "telhado" },
      regularizacoes: { tem: true, descricao: "averbação" },
    });

    const byTitle = Object.fromEntries(sections.map((s) => [s.title, s.rows]));
    expect(byTitle.Pagamento).toBeDefined();
    expect(byTitle.Pagamento.find((r) => r.label === "Modalidade")?.value).toBe(
      "Financiamento"
    );
    expect(
      byTitle.Pagamento.find((r) => r.label === "Valor total")?.value
    ).toContain("350");
    expect(byTitle.Comissão.find((r) => r.label === "Percentual")?.value).toBe(
      "6%"
    );
    expect(
      byTitle.Comissão.find((r) => r.label === "Comissionados")?.value
    ).toBe("2 envolvidos");
    expect(byTitle.Condições.find((r) => r.label === "Débitos")?.value).toContain(
      "IPTU"
    );
    expect(byTitle.Condições.find((r) => r.label === "Vícios")?.value).toBe(
      "telhado"
    );
  });

  it("omite seções/linhas vazias (zeros e defaults)", () => {
    const sections = buildNegotiationSummary({
      modalidade: "a_vista",
      pagamento: { valor_total: 0, sinal_arras: 0 },
      vicios: { opcao: "renuncia" }, // renúncia não vira linha
    });
    // Só "Modalidade" entra em Pagamento (valores zerados são omitidos).
    const pagamento = sections.find((s) => s.title === "Pagamento");
    expect(pagamento?.rows).toHaveLength(1);
    expect(sections.find((s) => s.title === "Condições")).toBeUndefined();
  });
});
