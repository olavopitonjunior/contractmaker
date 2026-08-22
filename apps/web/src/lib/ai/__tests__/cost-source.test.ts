import { describe, it, expect } from "vitest";
import { dividirPorProcedencia } from "../usage";

/**
 * A divisão medido × estimado do painel de custo.
 *
 * O que se protege é a honestidade do número: um total sem procedência esconde
 * que a parte estimada pode estar muito acima do real. Medido em 21/08 contra
 * o `gpt-5.4-nano`, um turn com 1792 de 1956 tokens vindos do cache de prefixo
 * custou US$ 0,00010614 enquanto a tabela de preços dizia US$ 0,00042870 —
 * 304% a mais.
 *
 * A entrada é um `groupBy(["costSource"])` do Prisma, e não a lista de linhas:
 * as linhas do painel vêm com `take: 5000` e truncariam justamente a parte
 * medida, que é a de maior volume.
 */
const grupo = (costSource: string | null, soma: unknown, calls: number) => ({
  costSource,
  _sum: { estimatedCostUsd: soma },
  _count: { _all: calls },
});

describe("dividirPorProcedencia", () => {
  it("separa medido de estimado, em valor e em contagem", () => {
    expect(
      dividirPorProcedencia([grupo("reported", 0.0003, 2), grupo("estimated", 0.001, 1)])
    ).toEqual({
      reportedUsd: 0.0003,
      estimatedUsd: 0.001,
      reportedCalls: 2,
      estimatedCalls: 1,
    });
  });

  /**
   * Linha anterior à coluna tem o default `"estimated"`, e `null` ou um valor
   * desconhecido caem do mesmo lado. Na dúvida sobre a procedência, o honesto
   * é chamar de estimativa — o contrário inflaria a confiança do painel.
   */
  it("procedência desconhecida conta como estimativa, nunca como medida", () => {
    const r = dividirPorProcedencia([
      grupo(null, 0.25, 1),
      grupo("coisa-nova-que-ninguem-conhece", 0.75, 3),
    ]);
    expect(r.reportedUsd).toBe(0);
    expect(r.reportedCalls).toBe(0);
    expect(r.estimatedUsd).toBe(1);
    expect(r.estimatedCalls).toBe(4);
  });

  /** Custo medido de zero (modelo `:free`) é medido, e conta como chamada. */
  it("zero medido continua sendo medido", () => {
    const r = dividirPorProcedencia([grupo("reported", 0, 5)]);
    expect(r.reportedCalls).toBe(5);
    expect(r.reportedUsd).toBe(0);
    expect(r.estimatedCalls).toBe(0);
  });

  /**
   * O Prisma devolve `Decimal`, não `number`. Somar Decimal com `+` daria
   * concatenação de string e um total absurdo no painel.
   */
  it("aceita Decimal do Prisma sem virar concatenação", () => {
    const decimal = (v: string) => ({ toString: () => v, valueOf: () => v });
    const r = dividirPorProcedencia([grupo("reported", decimal("0.30"), 2)]);
    expect(r.reportedUsd).toBe(0.3);
  });

  it("groupBy vazio é zero em tudo, não NaN", () => {
    expect(dividirPorProcedencia([])).toEqual({
      reportedUsd: 0,
      estimatedUsd: 0,
      reportedCalls: 0,
      estimatedCalls: 0,
    });
  });

  /** Valor corrompido não pode virar NaN e apagar o total inteiro do painel. */
  it("soma não-numérica vira 0 em vez de contaminar o total", () => {
    const r = dividirPorProcedencia([
      grupo("reported", "abc", 1),
      grupo("estimated", 0.5, 1),
    ]);
    expect(r.reportedUsd).toBe(0);
    expect(r.estimatedUsd).toBe(0.5);
  });

  /** `_sum` ausente acontece quando o grupo não tem linha somável. */
  it("grupo sem _sum não quebra", () => {
    const r = dividirPorProcedencia([{ costSource: "reported", _count: { _all: 3 } }]);
    expect(r.reportedUsd).toBe(0);
    expect(r.reportedCalls).toBe(3);
  });
});
