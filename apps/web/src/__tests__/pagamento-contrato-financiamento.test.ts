import { describe, it, expect } from "vitest";
import { enrichContractData } from "@/lib/services/contract-generation";
import { seedParcelas } from "@/lib/forms/payment-seed";

/**
 * Momento `contrato_financiamento` (2026-07-30) — a parcela financiada passou a
 * ter prazo próprio no formulário. O gerador precisa derivar `dias` como faz
 * com escritura/registro, e o "contados de" tem que sair com o texto da
 * assinatura do contrato de financiamento (não o genérico da assinatura do
 * CCV).
 *
 * Mora fora de lib/services/__tests__ de propósito (aquele diretório está em uso
 * por outra frente); o alvo é o mesmo `enrichContractData`.
 */

type AnyObj = Record<string, unknown>;

const parcelaFin = (extra: AnyObj = {}): AnyObj => ({
  tipo: "financiamento",
  valor: 800_000,
  momento: "contrato_financiamento",
  ...extra,
});

function enrichParcelas(parcelas: AnyObj[], config?: AnyObj): AnyObj[] {
  const enriched = enrichContractData({
    ...(config ? { config } : {}),
    pagamento: { valor_total: 1_000_000, parcelas },
  }) as AnyObj;
  return (enriched.pagamento as AnyObj).parcelas as AnyObj[];
}

describe("enrichContractData — momento contrato_financiamento", () => {
  it("preserva o prazo informado no formulário", () => {
    // Parcela financiada sai do loop `parcelas` no template de financiamento
    // (vira bucket hardcoded), então a asserção usa um cenário à vista + uma
    // parcela avulsa com o momento novo.
    const parcelas = enrichParcelas([
      { tipo: "outros", valor: 200_000, momento: "contrato_financiamento", dias: 45 },
    ]);
    expect(parcelas[0].dias).toBe(45);
    expect(parcelas[0].momento_texto).toContain("Contrato de Financiamento");
  });

  it("sem prazo informado, deriva do config.prazo_titulo_dias", () => {
    const parcelas = enrichParcelas(
      [{ tipo: "outros", valor: 200_000, momento: "contrato_financiamento" }],
      { prazo_titulo_dias: 90 },
    );
    expect(parcelas[0].dias).toBe(90);
  });

  it("sem config nenhuma, cai no piso de 60 dias (mesmo dos irmãos)", () => {
    const parcelas = enrichParcelas([
      { tipo: "outros", valor: 200_000, momento: "contrato_financiamento" },
    ]);
    expect(parcelas[0].dias).toBe(60);
  });

  it("a semeadura de financiamento gera o bucket de alienação fiduciária", () => {
    const seeded = seedParcelas("financiamento").map((p, i) => ({
      ...p,
      valor: i === 0 ? 200_000 : 800_000,
    })) as unknown as AnyObj[];
    const enriched = enrichContractData({
      pagamento: { valor_total: 1_000_000, parcelas: seeded },
    }) as AnyObj;
    const pag = enriched.pagamento as AnyObj;
    expect(pag.sinal_arras).toBe(200_000);
    expect(pag.alienacao_fiduciaria).toBe(800_000);
  });

  it("parcela financiada com o momento novo não quebra o bucket", () => {
    const enriched = enrichContractData({
      pagamento: { valor_total: 1_000_000, parcelas: [parcelaFin()] },
    }) as AnyObj;
    expect((enriched.pagamento as AnyObj).alienacao_fiduciaria).toBe(800_000);
  });
});
