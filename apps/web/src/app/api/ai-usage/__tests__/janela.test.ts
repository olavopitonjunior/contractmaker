import { describe, it, expect } from "vitest";
import { limiteSuperior } from "@/lib/ai/usage";
import { formatUsdPreciso } from "@/lib/ai/format";

/**
 * O fim da janela do painel de custo.
 *
 * Achado em 22/08: `?to=2026-08-22` virava meia-noite e o filtro `lte` cortava
 * o dia inteiro — o painel NUNCA mostrava o gasto do dia corrente, e uma
 * chamada feita agora só aparecia amanhã. Silencioso porque o número exibido
 * estava sempre certo PARA O INTERVALO PEDIDO; o intervalo é que não era o que
 * o botão prometia.
 */
describe("limiteSuperior", () => {
  it("data pura significa o DIA INTEIRO, não a meia-noite dele", () => {
    expect(limiteSuperior("2026-08-22").toISOString()).toBe(
      "2026-08-22T23:59:59.999Z"
    );
  });

  /** O caso concreto que o bug escondia, com o timestamp real do smoke. */
  it("uma linha criada hoje cai DENTRO da janela de hoje", () => {
    const linha = new Date("2026-08-22T17:49:31.907Z");
    expect(linha <= limiteSuperior("2026-08-22")).toBe(true);
    // Antes do conserto o limite era a meia-noite, e a linha ficava de fora:
    expect(linha <= new Date("2026-08-22")).toBe(false);
  });

  it("timestamp completo é respeitado como veio", () => {
    expect(limiteSuperior("2026-08-22T10:00:00.000Z").toISOString()).toBe(
      "2026-08-22T10:00:00.000Z"
    );
  });

  it("sem parâmetro é agora", () => {
    const antes = Date.now();
    expect(limiteSuperior(null).getTime()).toBeGreaterThanOrEqual(antes);
  });

  /** Entrada inválida continua inválida — quem recusa é o guard da rota. */
  it("data sem sentido devolve Invalid Date, em vez de inventar uma", () => {
    expect(Number.isNaN(limiteSuperior("ontem").getTime())).toBe(true);
  });
});

/**
 * O formatador da linha de procedência.
 *
 * O `formatUsd` do KPI colapsa tudo abaixo de um centavo em `"$ <0,01"`,
 * inclusive zero. Usá-lo aqui esconderia exatamente a diferença que a linha
 * existe para mostrar: um turn do Max custa ~US$ 0,0004, então medido e
 * estimado apareceriam como o mesmo `"$ <0,01"`.
 */
/**
 * Os botões de período, depois que o `to` passou a valer o dia inteiro.
 *
 * A janela virou `[D_from 00:00Z, D_to 23:59:59.999Z]` — os dois extremos
 * entram por completo. Com `now − 7×24h` isso dava OITO dias-calendário sob um
 * botão escrito "Últimos 7 dias": erro herdado que o conserto do dia corrente
 * expôs (antes o `to` era meia-noite e a conta fechava por acidente, às custas
 * de o dia de hoje sumir).
 */
describe("presetRange — o rótulo tem que bater com a janela", () => {
  const DIA = 24 * 60 * 60 * 1000;

  /** Réplica da conta do componente, para fixar a aritmética. */
  const diasCobertos = (voltarMs: number) => {
    const now = new Date("2026-08-22T10:00:00.000Z");
    const from = new Date(now.getTime() - voltarMs);
    const dFrom = new Date(from.toISOString().slice(0, 10) + "T00:00:00.000Z");
    const dTo = limiteSuperior(now.toISOString().slice(0, 10));
    return Math.round((dTo.getTime() - dFrom.getTime() + 1) / DIA);
  };

  it("6 dias para trás cobrem exatamente 7 dias-calendário", () => {
    expect(diasCobertos(6 * DIA)).toBe(7);
  });

  it("29 dias para trás cobrem exatamente 30", () => {
    expect(diasCobertos(29 * DIA)).toBe(30);
  });

  /** O que estava errado: a conta antiga entregava um dia a mais. */
  it("7 e 30 dariam 8 e 31 — é o erro que o conserto expôs", () => {
    expect(diasCobertos(7 * DIA)).toBe(8);
    expect(diasCobertos(30 * DIA)).toBe(31);
  });
});

describe("formatUsdPreciso", () => {
  it("mostra centavos de milésimo em vez de colapsar", () => {
    expect(formatUsdPreciso(0.00010614)).toBe("$ 0,000106");
    expect(formatUsdPreciso(0.0004137)).toBe("$ 0,000414");
  });

  /** É o ponto da linha inteira: com `formatUsd` os dois virariam "$ <0,01". */
  it("os dois lados do caso medido em 21/08 ficam DISTINGUÍVEIS", () => {
    expect(formatUsdPreciso(0.00010614)).not.toBe(formatUsdPreciso(0.0004137));
  });

  it("zero é zero, não '<0,01' — não afirma um custo que não existe", () => {
    expect(formatUsdPreciso(0)).toBe("$ 0");
  });

  it("acima de um centavo cai no formatador normal", () => {
    expect(formatUsdPreciso(1.5)).toContain("1,50");
  });
});
