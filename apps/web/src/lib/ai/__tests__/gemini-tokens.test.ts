import { describe, it, expect, vi, afterEach } from "vitest";
import { geminiUsageToTokens, calcCostUsd, PRICING } from "../usage";

/**
 * A tradução do `usageMetadata` do Gemini para as colunas de `AIUsage`.
 *
 * O que se protege é o custo de OUTPUT. Todos os call-sites do Gemini gravavam
 * `completionTokens: candidatesTokenCount` e ignoravam `thoughtsTokenCount` —
 * que o SDK devolve como campo SEPARADO e que o Google fatura como output
 * ("Output price (including thinking tokens)", na tabela oficial).
 *
 * Medido em 24/08 numa matrícula, com responseSchema:
 *
 *   gemini-2.5-flash:       65 candidates + 312 thoughts  → 377 de output
 *   gemini-3.5-flash-lite: 256 candidates +   0 thoughts  → 256
 *   gemini-3.1-flash-lite: 257 candidates +   0 thoughts  → 257
 *   gemma-4-31b-it:        243 candidates +   0 thoughts  → 243
 *
 * Ou seja: o painel reportava ~1/5 do output real do OCR, e o modelo em
 * produção era justamente o único que gastava raciocínio.
 */
describe("geminiUsageToTokens", () => {
  afterEach(() => vi.restoreAllMocks());

  it("soma thoughts ao completion — o caso que motivou a correção", () => {
    const tok = geminiUsageToTokens({
      promptTokenCount: 283,
      candidatesTokenCount: 65,
      thoughtsTokenCount: 312,
      totalTokenCount: 660,
    });
    expect(tok.completionTokens).toBe(377);
    expect(tok.thoughtsTokens).toBe(312);
    expect(tok.promptTokens).toBe(283);
  });

  it("modelo sem raciocínio não muda de comportamento", () => {
    const tok = geminiUsageToTokens({
      promptTokenCount: 545,
      candidatesTokenCount: 256,
      totalTokenCount: 801,
    });
    expect(tok.completionTokens).toBe(256);
    expect(tok.thoughtsTokens).toBe(0);
  });

  /**
   * O cache fica DENTRO de promptTokens de propósito. Separá-lo para a faixa
   * de cacheRead faria o token cacheado custar ZERO, porque nenhuma entrada
   * Gemini do PRICING define `cacheRead` e `calcCostUsd` usa `?? 0` — seria
   * trocar a subcontagem do output por uma da entrada. Cobrar a taxa cheia
   * superestima um pouco, e superestimar é o lado seguro.
   *
   * Este teste falha de propósito no dia em que alguém separar o cache sem
   * antes colocar as taxas na tabela.
   */
  it("mantém o cache dentro do prompt enquanto não há taxa de cacheRead", () => {
    const tok = geminiUsageToTokens({
      promptTokenCount: 1000,
      cachedContentTokenCount: 800,
      candidatesTokenCount: 50,
      totalTokenCount: 1050,
    });
    expect(tok.promptTokens).toBe(1000);
  });

  it("usage ausente vira zeros, não NaN", () => {
    const tok = geminiUsageToTokens(undefined);
    expect(tok).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      thoughtsTokens: 0,
    });
  });

  /**
   * A identidade `total = prompt + candidates + thoughts` bateu em todas as
   * sondas de 24/08. Se o Google mudar a conta, é melhor descobrir por log do
   * que por fatura — foi exatamente assim que o bug original passou despercebido.
   */
  it("avisa quando a soma não bate com totalTokenCount", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    geminiUsageToTokens(
      {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 5,
        totalTokenCount: 999,
      },
      "gemini-2.5-flash"
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("gemini-2.5-flash");
  });

  it("não avisa quando totalTokenCount vem ausente", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    geminiUsageToTokens({ promptTokenCount: 100, candidatesTokenCount: 10 });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("PRICING dos candidatos avaliados para o OCR", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemma-4-31b-it",
  ])("%s está na tabela — senão o custo vira 0 em silêncio", (model) => {
    expect(PRICING[model]).toBeDefined();
  });

  /**
   * Gemma é free-of-charge na API do Gemini. Zero aqui é o preço REAL, e
   * precisa ser declarado: sem a entrada na tabela, `calcCostUsd` também
   * devolveria 0 — mas por buraco, com o warn de "modelo sem pricing" junto.
   * Os dois zeros são indistinguíveis na coluna de custo; o warn é o que os
   * separa.
   */
  it("gemma custa zero SEM disparar o aviso de modelo desconhecido", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(calcCostUsd("gemma-4-31b-it", 100_000, 100_000)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("modelo fora da tabela continua avisando", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(calcCostUsd("modelo-que-nao-existe", 100, 100)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  /**
   * O número que decide a troca de modelo. Com o output real (candidates +
   * thoughts), o modelo em produção custa várias vezes mais que os candidatos
   * — e a maior parte disso é raciocínio que o usuário nunca vê.
   */
  it("o custo do 2.5-flash com raciocínio supera o dos candidatos sem raciocínio", () => {
    const flash = calcCostUsd("gemini-2.5-flash", 283, 65 + 312);
    const lite35 = calcCostUsd("gemini-3.5-flash-lite", 545, 256);
    const lite31 = calcCostUsd("gemini-3.1-flash-lite", 545, 257);
    expect(flash).toBeGreaterThan(lite35);
    expect(lite35).toBeGreaterThan(lite31);
  });

  /**
   * A regressão que o bug causava: ignorar thoughts subestima o custo do
   * modelo que raciocina. Não é arredondamento — é ordem de grandeza.
   */
  it("ignorar thoughts subestimaria o custo do OCR em mais de 3x", () => {
    const comThoughts = calcCostUsd("gemini-2.5-flash", 283, 65 + 312);
    const semThoughts = calcCostUsd("gemini-2.5-flash", 283, 65);
    expect(comThoughts / semThoughts).toBeGreaterThan(3);
  });
});
