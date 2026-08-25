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

  /**
   * A forma REAL do erro do Gemini — conferida no bundle instalado (1.50.1).
   * O SDK lança `ApiError` com `.status`, e a `message` é
   * `JSON.stringify({error:{message, code, status}})`. Não há "got status:" nem
   * "api key".
   *
   * Este era o buraco mais perigoso: como o FALLBACK também é Gemini, uma
   * `GEMINI_API_KEY` recusada apagaria os DOIS hops da cascata.
   */
  /**
   * ISOLA o campo estruturado: a mensagem é genérica de propósito, sem
   * `"code":`, sem `permission_denied`, sem `got status:`, sem "api key".
   *
   * A primeira versão deste caso usava o JSON completo do Gemini — e passava
   * mesmo sem o `err`, porque o texto casava por outro caminho. O comentário
   * dizia "casa pelo campo estruturado" e o teste não provava isso. Quebrar a
   * leitura de `.status` deixaria o teste verde, que é exatamente o ponto cego
   * que deixou passar o bug de esquecer o 2º argumento no log.
   */
  it("casa SÓ pelo campo estruturado .status, com mensagem genérica", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(isConfigCredentialError("forbidden", err)).toBe(true);
    // E a prova de que é o campo que decide: sem ele, este texto não casa.
    expect(isConfigCredentialError("forbidden")).toBe(false);
  });

  it("403 nativo do Gemini casa pelo corpo mesmo sem o campo estruturado", () => {
    const err = Object.assign(
      new Error(
        '{"error":{"message":"Generative Language API has not been used in project 123 or it is disabled.","code":403,"status":"PERMISSION_DENIED"}}'
      ),
      { status: 403 }
    );
    expect(isConfigCredentialError(err.message.toLowerCase(), err)).toBe(true);
  });

  it("403 nativo do Gemini casa pelo corpo JSON mesmo sem o campo estruturado", () => {
    // Sem `err`, sobra o texto: o corpo traz "code":403 e PERMISSION_DENIED.
    expect(
      isConfigCredentialError(
        '{"error":{"message":"api has not been used in project","code":403,"status":"permission_denied"}}'
      )
    ).toBe(true);
  });

  it("401 nativo do Gemini (UNAUTHENTICATED) casa", () => {
    expect(
      isConfigCredentialError(
        '{"error":{"message":"request had invalid authentication credentials","code":401,"status":"unauthenticated"}}'
      )
    ).toBe(true);
  });

  /**
   * Crédito esgotado vem como 429, mas é PERMANENTE — backoff não resolve,
   * trocar de provedor resolve. Se o guard de rate-limit rodasse antes, isto
   * reproduziria o mesmo apagão com a chave válida e sem saldo.
   */
  it("insufficient_quota (429 permanente da OpenAI) conta como config", () => {
    expect(
      isConfigCredentialError(
        'openai ocr got status: 429. {"error":{"type":"insufficient_quota","message":"you exceeded your current quota"}}'
      )
    ).toBe(true);
  });

  it("500 com code no corpo NÃO vira erro de credencial", () => {
    expect(isConfigCredentialError('{"error":{"code":500,"status":"internal"}}')).toBe(false);
  });

  it("exige as DUAS metades: falar de credencial e dizer que está ausente/recusada", () => {
    // Só "invalid" não basta — senão "invalid image" viraria erro de config.
    expect(isConfigCredentialError("invalid request payload")).toBe(false);
    // Só falar de api key não basta — pode ser outro problema qualquer.
    expect(isConfigCredentialError("api key rotated successfully")).toBe(false);
  });
});
