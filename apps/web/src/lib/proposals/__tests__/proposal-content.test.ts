import { describe, it, expect } from "vitest";
import { checkProposalContent } from "../clicksign-readiness";
import { buildProposalDataJson } from "../form-data";
import type { ProposalFormValues } from "../form-data";

/**
 * O documento sai com conteúdo?
 *
 * Estes testes existem por causa de um incidente, não de uma hipótese: em
 * 2026-08-04 duas propostas foram ENVIADAS a pessoas reais com o PDF sem
 * proponente, sem imóvel e sem valor, porque o agente gravou o `dataJson` numa
 * forma que o template não lê. `dataJson` é `z.record(z.unknown())` — a API
 * aceitou, o envio não olhou o corpo, e ninguém percebeu.
 *
 * Os dois primeiros casos são os `dataJson` REAIS daquelas propostas.
 */

// dataJson real da proposta cmsev8l0b… (enviada 04/08 16:22)
const REAL_INCIDENTE_1 = {
  valor: 1000000,
  imovel: { endereco: { numero: "606", logradouro: "Rua Senador Godói" } },
  partes: {
    vendedor: { nome: "Júnior Garrido", phone: "13 99782 6692" },
    proponente: { nome: "Patrícia Andrade", phone: "11 9812 68060" },
  },
  pagamento: { forma: "pagamento no ato da escritura", condicao: "à vista" },
};

// dataJson real da proposta cmseyv408… (enviada 04/08 18:03)
const REAL_INCIDENTE_2 = {
  imovel: { endereco: "Rua Coronel Meireles, 120, apartamento 37" },
  comissao: { corre_compradora: true, valor_percentual: 6 },
  pagamento: {
    forma: "à vista com financiamento",
    entrada: { valor: 200000 },
    financiamento: { valor: 200000 },
  },
};

describe("checkProposalContent — barra documento que sairia vazio", () => {
  it("REGRESSÃO: pega o dataJson da proposta enviada às 16:22", () => {
    const issues = checkProposalContent("compra_venda_v1", REAL_INCIDENTE_1);
    const campos = issues.map((i) => i.reason).join(" ");
    expect(campos).toContain("nome do proponente");
    expect(campos).toContain("endereço");
    expect(campos).toContain("valor");
  });

  it("REGRESSÃO: pega o dataJson da proposta enviada às 18:03", () => {
    const issues = checkProposalContent("compra_venda_v1", REAL_INCIDENTE_2);
    expect(issues.length).toBe(3);
  });

  it("as pendências do documento não são atribuídas a signatário", () => {
    const issues = checkProposalContent("compra_venda_v1", {});
    expect(issues.every((i) => i.signerIndex < 0)).toBe(true);
    expect(issues.every((i) => i.field === "documento")).toBe(true);
  });

  it("aceita o que a UI produz — a forma canônica", () => {
    const v = {
      kind: "venda",
      schemaType: "compra_venda_v1",
      proponentes: [
        {
          tipoPessoa: "fisica",
          nome: "Patrícia Andrade",
          documento: "",
          email: "",
          phone: "11970325533",
          canal: "whatsapp",
        },
      ],
      vendedores: [],
      imovelEndereco: "Rua Senador Godói, 606",
      ilistSnapshot: null,
      valor: "1.000.000,00",
      validadeDias: "7",
      comissao: false,
      esconderComissao: false,
      garantia: { tipo: "sem_garantia" },
      witnesses: [],
    } as unknown as ProposalFormValues;

    expect(checkProposalContent("compra_venda_v1", buildProposalDataJson(v))).toEqual([]);
  });

  it("locação olha locatarios e valor_aluguel, não compradores", () => {
    const ok = {
      locatarios: [{ nome: "Fulano de Tal" }],
      imoveis: [{ endereco: "Rua X, 1" }],
      locacao: { valor_aluguel: 3000 },
    };
    expect(checkProposalContent("locacao_residencial_v1", ok)).toEqual([]);
    // O mesmo objeto, lido como venda, está incompleto.
    expect(checkProposalContent("compra_venda_v1", ok).length).toBeGreaterThan(0);
  });

  it("valor zero ou negativo não conta como valor", () => {
    const base = {
      compradores: [{ nome: "Fulano de Tal" }],
      imoveis: [{ endereco: "Rua X, 1" }],
    };
    expect(checkProposalContent("compra_venda_v1", { ...base, pagamento: { valor_total: 0 } }).length).toBe(1);
    expect(checkProposalContent("compra_venda_v1", { ...base, pagamento: { valor_total: 500 } })).toEqual([]);
  });

  it("dataJson nulo não explode", () => {
    expect(() => checkProposalContent("compra_venda_v1", null)).not.toThrow();
    expect(checkProposalContent("compra_venda_v1", null).length).toBe(3);
  });
});
