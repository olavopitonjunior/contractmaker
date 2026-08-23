import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { limiteSuperior } from "@/lib/ui/date-range";
import { formatUsdPreciso } from "@/lib/ai/format";
import { presetRange, rotuloDia } from "@/lib/ui/date-range";

/**
 * ── POR QUE ESTE ARQUIVO FIXA O FUSO ──────────────────────────────────────
 *
 * O defeito que estes testes protegem é local-vs-UTC: a conta era feita em
 * horário local e serializada em UTC, o que desloca o limite um dia num fuso
 * NEGATIVO. Em UTC os dois coincidem — e aí todas as asserções passam por
 * acidente, **com o bug reintroduzido**.
 *
 * Medido: reintroduzindo o `new Date(ano, mes, 0, 23,59,59)` local, os testes
 * quebram sob `TZ=America/Sao_Paulo` e ficam 15/15 VERDES sob `TZ=UTC` — que é
 * o fuso do runner do GitHub Actions. Ou seja, o CI, que é quem barra o merge,
 * era cego justamente para o defeito que este arquivo existe para travar.
 *
 * Fixado aqui e não no `vitest.config.ts` de propósito: pinar o fuso global
 * mudaria os 4400+ testes de UTC para UTC-3 e poderia acordar falhas latentes
 * que não são deste trabalho.
 */
const TZ_ORIGINAL = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = TZ_ORIGINAL;
});

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
 * Os botões de período — testados na FUNÇÃO REAL, não numa réplica.
 *
 * A primeira versão deste teste recalculava a aritmética por conta própria, e
 * com isso ficava verde mesmo revertendo o conserto no componente. Achado em
 * code review, e é o motivo de `presetRange` ter saído do componente para o
 * lib com o `agora` injetável.
 *
 * Dois defeitos convivem aqui, e os dois estão fixados abaixo:
 *  · a janela cobria um dia a mais do que o rótulo (os dois extremos entram
 *    por completo desde que o `to` vale o dia inteiro);
 *  · a conta era feita em horário LOCAL e serializada em UTC, o que desloca
 *    o limite num fuso negativo.
 */
describe("presetRange", () => {
  // 22/08 às 13:00Z = 10:00 em São Paulo. Meio do dia nos dois fusos, para o
  // teste não passar por acidente de horário.
  const AGORA = new Date("2026-08-22T13:00:00.000Z");

  it("7 dias cobre exatamente 7 dias-calendário", () => {
    expect(presetRange("7d", AGORA)).toEqual({ from: "2026-08-16", to: "2026-08-22" });
  });

  it("30 dias cobre exatamente 30", () => {
    expect(presetRange("30d", AGORA)).toEqual({ from: "2026-07-24", to: "2026-08-22" });
  });

  it("mês atual começa no dia 1 do mês, não às 21h do dia anterior", () => {
    expect(presetRange("mtd", AGORA)).toEqual({ from: "2026-08-01", to: "2026-08-22" });
  });

  /**
   * O defeito que o conserto do dia corrente agravou: em UTC-3 o `to` saía
   * como `2026-08-01`, e com o dia inteiro valendo isso somava o 1º de agosto
   * dentro do total de JULHO.
   */
  it("mês anterior termina no último dia dele, sem invadir o mês atual", () => {
    expect(presetRange("last_month", AGORA)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  /** Vira o ano sem quebrar: janeiro → dezembro do ano anterior. */
  it("mês anterior atravessa a virada do ano", () => {
    const jan = new Date("2026-01-10T13:00:00.000Z");
    expect(presetRange("last_month", jan)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  /**
   * A prova de que a conta é em UTC: o resultado NÃO pode depender do fuso da
   * máquina de quem roda. Um instante logo depois da meia-noite UTC é, em
   * UTC-3, ainda o dia anterior — e era exatamente aí que a versão antiga
   * escorregava.
   */
  it("não depende do fuso local", () => {
    const logoAposMeiaNoiteUtc = new Date("2026-08-22T00:30:00.000Z");
    expect(presetRange("mtd", logoAposMeiaNoiteUtc).to).toBe("2026-08-22");
    expect(presetRange("7d", logoAposMeiaNoiteUtc)).toEqual({
      from: "2026-08-16",
      to: "2026-08-22",
    });
  });
});

/**
 * O rótulo do período — a legenda da janela, não a janela.
 *
 * Achado olhando a TELA de produção em 22/08: o painel dizia
 * `24/07/2026 → 23/08/2026` para uma janela que o servidor havia calculado
 * como `25/07 00:00Z → 23/08 23:59:59Z`. Só a borda ESQUERDA mentia.
 *
 * A assimetria é o que escondeu o defeito por tanto tempo: o `to` é fim-do-dia
 * UTC e sobrevive à conversão para UTC-3; o `from` é meia-noite UTC e cai para
 * o dia anterior. Com a direita certa, o rótulo parece plausível.
 *
 * Estes testes SÓ têm sentido com o fuso fixado no topo do arquivo — em UTC as
 * duas leituras coincidem e passariam com o bug de volta.
 */
describe("rotuloDia", () => {
  /** O caso exato visto na tela, com os instantes que a rota devolveu. */
  it("a borda esquerda mostra o dia que a query realmente usou", () => {
    expect(rotuloDia("2026-07-25T00:00:00.000Z")).toBe("25/07/2026");
  });

  /** A borda direita não pode mudar — ela já estava certa. */
  it("a borda direita continua no mesmo dia", () => {
    expect(rotuloDia("2026-08-23T23:59:59.999Z")).toBe("23/08/2026");
  });

  /**
   * A prova de que o rótulo descreve a janela: as duas pontas do que
   * `presetRange` decidiu têm que reaparecer inteiras na legenda.
   */
  it("rotula exatamente a janela que presetRange escolheu", () => {
    const { from, to } = presetRange("30d", new Date("2026-08-23T00:50:00.000Z"));
    expect(from).toBe("2026-07-25");
    expect(rotuloDia(`${from}T00:00:00.000Z`)).toBe("25/07/2026");
    expect(rotuloDia(limiteSuperior(to).toISOString())).toBe("23/08/2026");
  });

  /** Virada de ano e de mês são onde o deslocamento de um dia mais dói. */
  it("não escorrega na virada do ano", () => {
    expect(rotuloDia("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
    expect(rotuloDia("2026-03-01T00:00:00.000Z")).toBe("01/03/2026");
  });

  /** Lixo não vira data inventada. */
  it("entrada inválida vira travessão, não uma data qualquer", () => {
    expect(rotuloDia("ontem")).toBe("—");
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
