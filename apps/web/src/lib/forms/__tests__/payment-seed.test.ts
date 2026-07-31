import { describe, it, expect } from "vitest";
import {
  MODALIDADES,
  canReseedSilently,
  deriveModalidadeFromParcelas,
  parcelaRowLabel,
  parcelasMatchSeed,
  seedParcelas,
} from "../payment-seed";
import { MOMENTO_LABELS, MOMENTO_TEXTO } from "../payment-labels";
import { step5Schema } from "../validation";

describe("seedParcelas", () => {
  it("à vista abre entrada na assinatura + saldo na escritura", () => {
    const parcelas = seedParcelas("a_vista");
    expect(parcelas).toHaveLength(2);
    expect(parcelas[0]).toMatchObject({ tipo: "sinal_arras", momento: "assinatura" });
    expect(parcelas[1]).toMatchObject({
      tipo: "recursos_proprios",
      momento: "escritura",
    });
  });

  it("financiamento abre entrada + parcela financiada no contrato de financiamento", () => {
    const parcelas = seedParcelas("financiamento");
    expect(parcelas).toHaveLength(2);
    expect(parcelas[0]).toMatchObject({ tipo: "sinal_arras", momento: "assinatura" });
    expect(parcelas[1]).toMatchObject({
      tipo: "financiamento",
      momento: "contrato_financiamento",
    });
  });

  it("nasce com valores zerados (o rodapé soma × total é quem guia)", () => {
    for (const m of MODALIDADES) {
      for (const p of seedParcelas(m)) {
        expect(p.valor).toBe(0);
        expect(p.dias).toBe(0);
        expect(p.tipo_texto).toBe("");
      }
    }
  });

  it("a semeadura passa pelo schema da etapa de pagamento", () => {
    for (const m of MODALIDADES) {
      const parsed = step5Schema.safeParse({
        modalidade: m,
        pagamento: { valor_total: 0, parcelas: seedParcelas(m) },
      });
      expect(parsed.success, m).toBe(true);
    }
  });
});

describe("momento contrato_financiamento", () => {
  it("está no enum, nos labels da UI e no texto canônico da cláusula", () => {
    const parsed = step5Schema.safeParse({
      pagamento: {
        valor_total: 0,
        parcelas: [{ tipo: "financiamento", momento: "contrato_financiamento" }],
      },
    });
    expect(parsed.success).toBe(true);
    expect(MOMENTO_LABELS.contrato_financiamento).toBeTruthy();
    expect(MOMENTO_TEXTO.contrato_financiamento).toContain("Financiamento");
  });

  it("os momentos antigos continuam válidos (mudança aditiva)", () => {
    for (const momento of ["assinatura", "escritura", "registro", "dias", "data_exata"]) {
      const parsed = step5Schema.safeParse({
        pagamento: { valor_total: 0, parcelas: [{ momento }] },
      });
      expect(parsed.success, momento).toBe(true);
    }
  });
});

describe("deriveModalidadeFromParcelas", () => {
  it("uma parcela financiada classifica o negócio inteiro", () => {
    expect(
      deriveModalidadeFromParcelas([
        { tipo: "sinal_arras" },
        { tipo: "financiamento" },
      ]),
    ).toBe("financiamento");
  });

  it("banco do financiamento sozinho também", () => {
    expect(deriveModalidadeFromParcelas([{ tipo: "sinal_arras" }], "caixa")).toBe(
      "financiamento",
    );
  });

  it("sem financiamento é à vista; lista vazia/ausente também", () => {
    expect(deriveModalidadeFromParcelas([{ tipo: "recursos_proprios" }])).toBe("a_vista");
    expect(deriveModalidadeFromParcelas([])).toBe("a_vista");
    expect(deriveModalidadeFromParcelas(undefined)).toBe("a_vista");
  });
});

describe("re-semeadura ao trocar a modalidade", () => {
  it("semeadura intacta é substituída em silêncio", () => {
    expect(parcelasMatchSeed(seedParcelas("a_vista"), "a_vista")).toBe(true);
    expect(canReseedSilently(seedParcelas("a_vista"), "a_vista")).toBe(true);
    expect(canReseedSilently(seedParcelas("financiamento"), "financiamento")).toBe(true);
  });

  it("lista vazia ou só de linhas em branco também", () => {
    expect(canReseedSilently([], "a_vista")).toBe(true);
    expect(canReseedSilently([{ tipo: "", valor: 0 }], "a_vista")).toBe(true);
  });

  it("valor digitado bloqueia (a UI pergunta antes)", () => {
    const editadas = seedParcelas("a_vista");
    editadas[0].valor = 50_000;
    expect(parcelasMatchSeed(editadas, "a_vista")).toBe(false);
    expect(canReseedSilently(editadas, "a_vista")).toBe(false);
  });

  it("parcela extra ou tipo trocado à mão bloqueiam", () => {
    const extra = [...seedParcelas("a_vista"), { tipo: "fgts", valor: 0 }];
    expect(canReseedSilently(extra, "a_vista")).toBe(false);
    expect(canReseedSilently([{ tipo: "fgts", valor: 0 }], "a_vista")).toBe(false);
  });

  it("prazo em dias preenchido conta como edição", () => {
    const comPrazo = seedParcelas("financiamento");
    comPrazo[1].dias = 45;
    expect(canReseedSilently(comPrazo, "financiamento")).toBe(false);
  });
});

describe("parcelaRowLabel", () => {
  it("rotula as linhas semeadas pelo papel, não pelo índice", () => {
    const aVista = seedParcelas("a_vista");
    expect(parcelaRowLabel(aVista[0], 0)).toBe("Entrada / Sinal");
    expect(parcelaRowLabel(aVista[1], 1)).toBe("Escritura");
    const fin = seedParcelas("financiamento");
    expect(parcelaRowLabel(fin[1], 1)).toBe("Financiamento");
  });

  it("parcela sem tipo cai no número", () => {
    expect(parcelaRowLabel({}, 2)).toBe("Parcela 3");
  });
});
