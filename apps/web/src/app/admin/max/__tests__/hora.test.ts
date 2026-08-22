import { describe, it, expect } from "vitest";
import { horaSP } from "../hora";

/**
 * O defeito que isto trava foi visto em PRODUÇÃO, em 21/08: a mesma tela dizia
 * "Janela 7h–22h · Fechada" e "Próxima entrega 10:00". Nenhum dos dois estava
 * errado — a janela é de São Paulo e a hora era UTC, e 10:00 UTC é 7h em SP.
 * Lado a lado, parecia a janela quebrada.
 *
 * A causa é sutil e volta fácil: são server components, e
 * `toLocaleString("pt-BR")` sem `timeZone` usa o fuso do PROCESSO. No Mac de
 * quem desenvolve isso é São Paulo e a tela fica certa; na Vercel é UTC e ela
 * fica errada. Ou seja: o modo de falha não aparece em desenvolvimento.
 *
 * Por isso o teste fixa um instante conhecido e afirma o horário de SP —
 * independente do fuso onde ele estiver rodando.
 */
describe("horaSP", () => {
  it("formata em São Paulo, não no fuso do processo", () => {
    // 10:00 UTC = 07:00 em São Paulo (UTC-3). É exatamente o par de números
    // que gerou a confusão: 10:00 é o que a tela mostrava, 7h é a janela.
    expect(horaSP("2026-08-22T10:00:00Z")).toBe("22/08/2026, 07:00:00 (SP)");
  });

  it("marca o fuso na saída — hora sem fuso já custou investigação", () => {
    expect(horaSP("2026-08-21T18:32:09Z")).toContain("(SP)");
    expect(horaSP("2026-08-21T18:32:09Z")).toContain("15:32:09");
  });

  /**
   * Vira o dia no fuso de SP antes de virar em UTC. Se a conversão fosse feita
   * por subtração de horas em vez de pelo `Intl`, esta é a linha que quebraria.
   */
  it("acerta a data quando os dois fusos discordam do dia", () => {
    expect(horaSP("2026-08-22T02:30:00Z")).toBe("21/08/2026, 23:30:00 (SP)");
  });
});
