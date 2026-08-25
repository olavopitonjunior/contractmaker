import { describe, it, expect } from "vitest";
import { isConfigCredentialError } from "../ocr";

/**
 * Credencial ausente era a ÚNICA classe de falha do OCR que apagava em vez de
 * degradar.
 *
 * `GEMINI_OCR_MODEL=gpt-5.6-luna` sem `OPENAI_API_KEY` fazia `chamarOpenAIOcr`
 * lançar "OPENAI_API_KEY nao configurada". Essa mensagem não casava nenhum
 * padrão de `shouldTryFallbackModel`, então o fallback Gemini era pulado — e o
 * último recurso Claude também, porque ele só roda dentro do catch do fallback.
 * Resultado: 100% das extrações falhando, sem degradação nenhuma.
 *
 * Agrava que o `.env.example` recomenda `gpt-5.6-luna` como o melhor do bench:
 * a documentação empurrava para o pé do abismo.
 */
describe("isConfigCredentialError", () => {
  it("reconhece a mensagem que o caminho OpenAI realmente lança", () => {
    // Sem acento, exatamente como está em ocr-openai.ts.
    expect(isConfigCredentialError("openai_api_key nao configurada")).toBe(true);
    // E com acento, para quem corrigir o texto um dia.
    expect(isConfigCredentialError("openai_api_key não configurada")).toBe(true);
  });

  it("reconhece recusa 401/403 do provedor — na prática é a mesma coisa", () => {
    expect(isConfigCredentialError("401 unauthorized: invalid api key")).toBe(true);
    expect(isConfigCredentialError("403 forbidden — api key does not have access")).toBe(true);
    expect(isConfigCredentialError("missing api key")).toBe(true);
    expect(isConfigCredentialError("api_key not configured")).toBe(true);
  });

  it("NÃO confunde erro de documento com erro de credencial", () => {
    expect(isConfigCredentialError("invalid image data")).toBe(false);
    expect(isConfigCredentialError("failed to decode pdf")).toBe(false);
    expect(isConfigCredentialError("500 internal error")).toBe(false);
    expect(isConfigCredentialError("safety block: content blocked")).toBe(false);
  });

  it("NÃO casa com rate limit, que precisa de backoff e não de outro modelo", () => {
    // A palavra "quota" sozinha não deve arrastar nada para cá; e mesmo uma
    // mensagem que cite api key junto de quota é tratada antes, pelo guard de
    // rate-limit em shouldTryFallbackModel.
    expect(isConfigCredentialError("resource_exhausted: quota exceeded")).toBe(false);
    expect(isConfigCredentialError("429 too many requests")).toBe(false);
  });

  /**
   * O vizinho do bug, e o mais traiçoeiro: chave VÁLIDA, mas o projeto não tem
   * acesso ao modelo (ex.: `gpt-5.6-luna` não liberado). O provedor devolve 403
   * e o corpo tipicamente NÃO diz "api key" — então a heurística de texto não
   * pega, e sem a cláusula de status isso apagaria 100% das extrações do mesmo
   * jeito, só que com a chave presente.
   */
  it("403 por falta de acesso ao modelo casa pela FORMA que este código lança", () => {
    expect(
      isConfigCredentialError(
        'openai ocr got status: 403. {"error":{"message":"project does not have access to model gpt-5.6-luna"}}'
      )
    ).toBe(true);
  });

  it("401 casa pelo status mesmo sem o texto do provedor", () => {
    expect(isConfigCredentialError("openai ocr got status: 401. {}")).toBe(true);
  });

  it("outros status NÃO casam — 500 é falha do provedor, não config", () => {
    expect(isConfigCredentialError("openai ocr got status: 500. {}")).toBe(false);
    expect(isConfigCredentialError("openai ocr got status: 429. {}")).toBe(false);
  });

  it("exige as DUAS metades: falar de credencial e dizer que está ausente/recusada", () => {
    // Só "invalid" não basta — senão "invalid image" viraria erro de config.
    expect(isConfigCredentialError("invalid request payload")).toBe(false);
    // Só falar de api key não basta — pode ser outro problema qualquer.
    expect(isConfigCredentialError("api key rotated successfully")).toBe(false);
  });
});
