import { describe, it, expect } from "vitest";
import { dadosContratoSchema } from "../validation";

/**
 * Valida superRefine pagamento: soma de parcelas == valor_total.
 * Bloco adicionado em 2026-05-16 pra acompanhar a unificação das parcelas
 * tipadas no PagamentoStep.
 */

const BASE = {
  vendedores: [
    {
      tipo_pessoa: "fisica" as const,
      nome: "João Silva",
    },
  ],
  compradores: [
    {
      tipo_pessoa: "fisica" as const,
      nome: "Maria Souza",
    },
  ],
  imoveis: [
    {
      descricao: "Apartamento com 70m² em São Paulo",
    },
  ],
};

describe("dadosContratoSchema — soma parcelas vs valor_total", () => {
  it("aceita quando soma das parcelas bate com valor_total (à vista)", () => {
    const result = dadosContratoSchema.safeParse({
      ...BASE,
      pagamento: {
        valor_total: 500_000,
        parcelas: [
          { tipo: "sinal_arras", valor: 50_000, momento: "assinatura" },
          { tipo: "recursos_proprios", valor: 450_000, momento: "escritura" },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("aceita quando há valor_total mas nenhuma parcela (rascunho)", () => {
    const result = dadosContratoSchema.safeParse({
      ...BASE,
      pagamento: {
        valor_total: 500_000,
        parcelas: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejeita quando soma das parcelas diverge do valor_total", () => {
    const result = dadosContratoSchema.safeParse({
      ...BASE,
      pagamento: {
        valor_total: 500_000,
        parcelas: [
          { tipo: "sinal_arras", valor: 50_000, momento: "assinatura" },
          { tipo: "financiamento", valor: 300_000, momento: "registro" },
        ],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message).join("\n");
      expect(msgs).toMatch(/Soma das parcelas/i);
    }
  });

  it("tolera diferença ≤ 0.01 (centavos de arredondamento)", () => {
    const result = dadosContratoSchema.safeParse({
      ...BASE,
      pagamento: {
        valor_total: 100,
        parcelas: [
          { tipo: "sinal_arras", valor: 33.33, momento: "assinatura" },
          { tipo: "recursos_proprios", valor: 33.33, momento: "assinatura" },
          { tipo: "recursos_proprios", valor: 33.34, momento: "assinatura" },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});
