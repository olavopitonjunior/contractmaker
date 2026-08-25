import { describe, it, expect } from "vitest";
import { humanizeOcrError } from "../ocr";

/**
 * A mensagem que o CORRETOR lê quando a extração falha.
 *
 * Alimenta 6 rotas (`forms/[token]/attachments/{[id]/extract,batch-extract}`,
 * `deals/[dealId]/{extract-fields,attachments/[attachmentId]/extract}`, o
 * worker) e não tinha teste nenhum. Este arquivo nasce porque a branch de
 * credencial entrou como PRIMEIRA checagem — mexer na ordem de uma função de
 * texto sem cobertura é como ela quebra em silêncio.
 *
 * O erro que mais importa evitar aqui é dizer a coisa errada: mandar conferir
 * o arquivo quando o problema é config faz o corretor repetir trabalho que
 * nunca vai funcionar; dizer que é config quando o PDF está corrompido esconde
 * dele a única ação que resolveria.
 */
describe("humanizeOcrError", () => {
  it("credencial: diz que NÃO é o arquivo dele", () => {
    const m = humanizeOcrError("OPENAI_API_KEY nao configurada");
    expect(m).toContain("não é problema do seu arquivo");
  });

  it("credencial via corpo nativo do Gemini", () => {
    const m = humanizeOcrError(
      '{"error":{"message":"api not enabled","code":403,"status":"PERMISSION_DENIED"}}'
    );
    expect(m).toContain("não é problema do seu arquivo");
  });

  /**
   * O falso positivo que mais me preocupa: erro de DOCUMENTO recebendo a
   * mensagem de config. O corretor deixaria de trocar o arquivo — que é
   * exatamente o que resolveria.
   */
  it("imagem inválida continua sendo erro de ARQUIVO, não de config", () => {
    const m = humanizeOcrError("invalid image data: could not decode");
    expect(m).toContain("Verifique se é uma imagem nítida");
    expect(m).not.toContain("configuração do sistema");
  });

  it("PDF ilegível continua sendo erro de arquivo", () => {
    const m = humanizeOcrError("failed to decode pdf — unsupported format");
    expect(m).toContain("Verifique se é uma imagem nítida");
  });

  it("safety block continua sendo safety", () => {
    const m = humanizeOcrError("content blocked by safety filter");
    expect(m).toContain("filtro de segurança");
    expect(m).not.toContain("configuração do sistema");
  });

  it("rate limit transitório continua mandando aguardar", () => {
    const m = humanizeOcrError("429 rate limit exceeded, retry later");
    expect(m).toContain("Aguarde");
    expect(m).not.toContain("configuração do sistema");
  });

  /**
   * Crédito esgotado é config, não espera. Mandar "aguarde um minuto" faria o
   * corretor tentar de novo para sempre — o saldo não volta sozinho.
   */
  it("insufficient_quota é config, não 'aguarde um minuto'", () => {
    const m = humanizeOcrError(
      'openai ocr got status: 429. {"error":{"type":"insufficient_quota"}}'
    );
    expect(m).toContain("não é problema do seu arquivo");
    expect(m).not.toContain("Aguarde");
  });

  it("500 do provedor continua sendo erro interno", () => {
    const m = humanizeOcrError("500 internal server error");
    expect(m).toContain("erro interno");
  });

  it("timeout continua sendo timeout", () => {
    const m = humanizeOcrError("deadline exceeded");
    expect(m).toContain("demorou demais");
  });

  it("mensagem desconhecida cai no genérico, sem inventar causa", () => {
    const m = humanizeOcrError("algo totalmente inesperado aconteceu");
    expect(m).toContain("Falha na extração");
  });

  it("não duplica o prefixo quando a mensagem já começa com 'Falha na extra'", () => {
    const m = humanizeOcrError("Falha na extração: coisa esquisita");
    expect(m).toBe("Falha na extração: coisa esquisita");
  });

  it("mensagem muito longa não é despejada na tela do corretor", () => {
    const m = humanizeOcrError("x".repeat(400));
    expect(m).toBe("Falha na extração. Tente novamente ou use outro arquivo.");
  });
});
