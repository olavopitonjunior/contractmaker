import { describe, expect, it, afterEach } from "vitest";
import {
  esforcoDeRaciocinio,
  isModeloOpenAI,
  schemaJsonDeCampos,
} from "../ocr-openai";
import { calcCostUsd, PRICING } from "../usage";

/**
 * Caminho OpenAI do OCR.
 *
 * Entrou porque o `gpt-5.6-luna` leu melhor que qualquer candidato Gemini no
 * bench de 25/08 sobre 10 documentos reais: 91,0% de acurácia ponderada e
 * 5,8% de omissão, contra 79,0% e 14,9% do modelo em produção.
 */
describe("isModeloOpenAI — despacho de provedor", () => {
  it.each(["gpt-5.6-luna", "gpt-5.6-luna-pro", "gpt-4o"])(
    "%s sai pelo caminho OpenAI",
    (m) => expect(isModeloOpenAI(m)).toBe(true)
  );

  it.each([
    "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
    "gemma-4-31b-it",
    "claude-haiku-4-5-20251001",
  ])("%s NÃO sai pelo caminho OpenAI", (m) =>
    expect(isModeloOpenAI(m)).toBe(false)
  );
});

describe("esforcoDeRaciocinio", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  /**
   * O pedido original foi por um modelo "gpt-5.6-luna-xhigh". Esse ID não
   * existe: `xhigh` é valor de `reasoning_effort`, um PARÂMETRO. Verificado
   * contra a API — o valor é aceito.
   */
  it("aceita xhigh, que era o sufixo confundido com nome de modelo", () => {
    expect(
      esforcoDeRaciocinio({ OCR_OPENAI_REASONING_EFFORT: "xhigh" } as NodeJS.ProcessEnv)
    ).toBe("xhigh");
  });

  it("sem env, usa `high` — não o máximo", () => {
    // `xhigh` gasta muito mais raciocínio (medido: 7801 tokens de saída num
    // PDF). Deixar o teto como padrão faria todo documento pagar o pior caso.
    expect(esforcoDeRaciocinio({} as NodeJS.ProcessEnv)).toBe("high");
  });

  it("string vazia cai no padrão", () => {
    expect(
      esforcoDeRaciocinio({ OCR_OPENAI_REASONING_EFFORT: "  " } as NodeJS.ProcessEnv)
    ).toBe("high");
  });
});

describe("schemaJsonDeCampos", () => {
  it("declara properties — objeto vazio faria o modelo devolver {}", () => {
    const s = schemaJsonDeCampos(["nome_completo", "cpf_numero"]) as any;
    expect(Object.keys(s.properties.campos.properties)).toEqual([
      "nome_completo",
      "cpf_numero",
    ]);
  });

  it("todo campo aceita null — senão volta a string 'null'", () => {
    const s = schemaJsonDeCampos(["cpf_numero"]) as any;
    expect(s.properties.campos.properties.cpf_numero.type).toContain("null");
  });
});

describe("pricing do caminho OpenAI", () => {
  /**
   * O id da API direta não tem o prefixo `openai/` do OpenRouter. Sem entrada
   * própria, o custo do OCR viraria zero em silêncio — o mesmo modo de falha
   * que a tabela toda tem.
   */
  it("gpt-5.6-luna tem pricing com o id da API direta", () => {
    expect(PRICING["gpt-5.6-luna"]).toBeDefined();
    expect(calcCostUsd("gpt-5.6-luna", 1_000_000, 0)).toBeCloseTo(0.2, 6);
    expect(calcCostUsd("gpt-5.6-luna", 0, 1_000_000)).toBeCloseTo(1.2, 6);
  });

  /**
   * Na OpenAI o raciocínio JÁ está dentro de `completion_tokens` — verificado
   * contra a API (651 completion, dos quais 512 de raciocínio). Somá-lo de novo
   * dobraria o custo reportado, que é o espelho do bug corrigido no Gemini.
   */
  it("o raciocínio não é somado duas vezes", () => {
    const completionComRaciocinio = 651;
    const custo = calcCostUsd("gpt-5.6-luna", 1884, completionComRaciocinio);
    const custoSeSomasseDeNovo = calcCostUsd("gpt-5.6-luna", 1884, 651 + 512);
    expect(custo).toBeLessThan(custoSeSomasseDeNovo);
  });
});
