import { describe, it, expect } from "vitest";
import { dividirPorProcedencia } from "../usage";

/**
 * A divisão medido × estimado do painel de custo.
 *
 * O que se protege aqui é a honestidade do número: um total sem procedência
 * esconde que a parte estimada pode estar muito acima do real. Medido em
 * 21/08 contra o `gpt-5.4-nano`, um turn com 1792 de 1956 tokens vindos do
 * cache de prefixo custou US$ 0,00010614 enquanto a tabela de preços dizia
 * US$ 0,00042870 — 304% a mais.
 */
describe("dividirPorProcedencia", () => {
  it("separa medido de estimado, em valor e em contagem", () => {
    const r = dividirPorProcedencia([
      { costSource: "reported", estimatedCostUsd: 0.0001 },
      { costSource: "reported", estimatedCostUsd: 0.0002 },
      { costSource: "estimated", estimatedCostUsd: 0.001 },
    ]);
    expect(r).toEqual({
      reportedUsd: 0.0003,
      estimatedUsd: 0.001,
      reportedCalls: 2,
      estimatedCalls: 1,
    });
  });

  /**
   * Linha anterior à coluna tem o default `"estimated"`, e `null`/ausente cai
   * do mesmo lado. Na dúvida sobre a procedência, o honesto é chamar de
   * estimativa — o contrário inflaria a confiança do painel.
   */
  it("procedência desconhecida conta como estimativa, nunca como medida", () => {
    const r = dividirPorProcedencia([
      { estimatedCostUsd: 0.5 },
      { costSource: null, estimatedCostUsd: 0.25 },
      { costSource: "coisa-nova-que-ninguem-conhece", estimatedCostUsd: 0.25 },
    ]);
    expect(r.reportedUsd).toBe(0);
    expect(r.reportedCalls).toBe(0);
    expect(r.estimatedUsd).toBe(1);
    expect(r.estimatedCalls).toBe(3);
  });

  /** Custo medido de zero (modelo `:free`) é medido, e conta como chamada. */
  it("zero medido continua sendo medido", () => {
    const r = dividirPorProcedencia([{ costSource: "reported", estimatedCostUsd: 0 }]);
    expect(r.reportedCalls).toBe(1);
    expect(r.reportedUsd).toBe(0);
    expect(r.estimatedCalls).toBe(0);
  });

  /**
   * O Prisma devolve `Decimal`, não `number`. Somar Decimal com `+` daria
   * concatenação de string e um total absurdo no painel.
   */
  it("aceita Decimal do Prisma sem virar concatenação", () => {
    const decimal = (v: string) => ({ toString: () => v, valueOf: () => v });
    const r = dividirPorProcedencia([
      { costSource: "reported", estimatedCostUsd: decimal("0.10") },
      { costSource: "reported", estimatedCostUsd: decimal("0.20") },
    ]);
    expect(r.reportedUsd).toBe(0.3);
  });

  it("lista vazia é zero em tudo, não NaN", () => {
    expect(dividirPorProcedencia([])).toEqual({
      reportedUsd: 0,
      estimatedUsd: 0,
      reportedCalls: 0,
      estimatedCalls: 0,
    });
  });

  /** Valor corrompido não pode virar NaN e apagar o total inteiro do painel. */
  it("valor não-numérico vira 0 em vez de contaminar a soma", () => {
    const r = dividirPorProcedencia([
      { costSource: "reported", estimatedCostUsd: "abc" },
      { costSource: "reported", estimatedCostUsd: 0.5 },
    ]);
    expect(r.reportedUsd).toBe(0.5);
  });
});
