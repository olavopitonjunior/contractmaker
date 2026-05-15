import { describe, it, expect } from "vitest";
import { enrichContractData } from "../contract-generation";

/**
 * Testa o enrichContractData reescrito em 2026-05-16:
 *   1. Deriva buckets nomeados a partir de parcelas tipadas
 *   2. Filtra parcelas que viraram bucket hardcoded no template
 *   3. Deriva dias e tipo_texto canônicos
 *   4. Preserva forms legados sem `tipo` setado
 */

type AnyObj = Record<string, unknown>;

describe("enrichContractData — derivação de buckets de pagamento", () => {
  it("à vista: soma sinal + recursos_próprios e filtra duplicação do sinal", () => {
    const enriched = enrichContractData({
      pagamento: {
        valor_total: 500_000,
        parcelas: [
          { tipo: "sinal_arras", valor: 50_000, momento: "assinatura" },
          { tipo: "recursos_proprios", valor: 450_000, momento: "escritura" },
        ],
      },
    }) as AnyObj;

    const pag = enriched.pagamento as AnyObj;
    expect(pag.sinal_arras).toBe(50_000);
    expect(pag.recursos_proprios).toBe(450_000);
    expect(pag.fgts).toBe(0);
    expect(pag.alienacao_fiduciaria).toBe(0);

    // À vista: só "sinal_arras" é hardcoded no template — só ele some.
    // "recursos_proprios" CONTINUA no loop pra o template entrar no branch
    // {{#each parcelas}} (template a_vista linha 188).
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0].tipo).toBe("recursos_proprios");
  });

  it("financiamento: filtra sinal/financiamento/fgts/recursos do loop", () => {
    const enriched = enrichContractData({
      pagamento: {
        valor_total: 1_000_000,
        parcelas: [
          { tipo: "sinal_arras", valor: 50_000, momento: "assinatura" },
          { tipo: "financiamento", valor: 850_000, momento: "registro" },
          { tipo: "fgts", valor: 100_000, momento: "escritura" },
        ],
      },
    }) as AnyObj;

    const pag = enriched.pagamento as AnyObj;
    expect(pag.sinal_arras).toBe(50_000);
    expect(pag.alienacao_fiduciaria).toBe(850_000);
    expect(pag.fgts).toBe(100_000);

    // Modalidade detectada como financiamento → todos os 3 são hardcoded.
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas).toHaveLength(0);
  });

  it("permuta_veiculo cai em outras_formas e fica no loop", () => {
    const enriched = enrichContractData({
      pagamento: {
        valor_total: 200_000,
        parcelas: [
          { tipo: "sinal_arras", valor: 50_000, momento: "assinatura" },
          {
            tipo: "permuta_veiculo",
            valor: 150_000,
            momento: "assinatura",
            permuta_descricao: "Honda Civic 2022 placa ABC1234",
          },
        ],
      },
    }) as AnyObj;

    const pag = enriched.pagamento as AnyObj;
    expect(pag.outras_formas).toBe(150_000);
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0].tipo).toBe("permuta_veiculo");
    // tipo_texto derivado inclui descrição
    expect(parcelas[0].tipo_texto).toMatch(/Permuta com veículo/);
    expect(parcelas[0].tipo_texto).toMatch(/Honda Civic/);
  });

  it("forma legada (sem tipo) preserva buckets originais sem derivar", () => {
    const enriched = enrichContractData({
      pagamento: {
        valor_total: 500_000,
        sinal_arras: 100_000,
        recursos_proprios: 400_000,
        // Parcela legada sem `tipo` — não sobrescreve buckets, fica no loop
        parcelas: [
          { tipo_texto: "Primeira parcela", dias: 30, valor: 100_000 },
        ],
      },
    }) as AnyObj;

    const pag = enriched.pagamento as AnyObj;
    expect(pag.sinal_arras).toBe(100_000);
    expect(pag.recursos_proprios).toBe(400_000);
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas).toHaveLength(1);
    expect(parcelas[0].letra).toBe("b");
    expect(parcelas[0].numero).toBe(1);
  });

  it("deriva dias a partir do momento canônico", () => {
    const enriched = enrichContractData({
      config: { prazo_escritura_dias: 45 },
      pagamento: {
        valor_total: 100_000,
        parcelas: [
          { tipo: "recursos_proprios", valor: 100_000, momento: "escritura" },
        ],
      },
    }) as AnyObj;
    const pag = enriched.pagamento as AnyObj;
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas[0].dias).toBe(45);
  });

  it("deriva tipo_texto canônico quando vazio", () => {
    const enriched = enrichContractData({
      pagamento: {
        valor_total: 50_000,
        parcelas: [
          { tipo: "recursos_proprios", valor: 50_000, momento: "assinatura" },
        ],
      },
    }) as AnyObj;
    const pag = enriched.pagamento as AnyObj;
    const parcelas = pag.parcelas as Array<AnyObj>;
    expect(parcelas[0].tipo_texto).toBe("Recursos próprios");
  });
});
