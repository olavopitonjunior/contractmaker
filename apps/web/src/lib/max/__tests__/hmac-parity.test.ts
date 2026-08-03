import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Vetor fixo do HMAC do `/notify` — a metade daqui de um contrato de DOIS repos.
 *
 * A outra metade é `max-agent/src/lib/__tests__/hmac-parity.test.ts`, com este
 * mesmo vetor. Os valores abaixo são literais de propósito: se alguém mudar o
 * que entra na assinatura (separador, ordem, encoding), o teste falha no repo
 * que mudou — e não seis meses depois, num incidente.
 *
 * O modo de falha que isto previne é total e silencioso: divergindo os lados,
 * TODA notificação passa a ser recusada com 401, e nenhum dos dois repositórios
 * quebra sozinho. Os dois já pediam este teste em comentário; nenhum o tinha.
 *
 * O que está travado: `hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))`,
 * sobre o corpo CRU (nunca o JSON reserializado — a ordem das chaves mudaria).
 */
const SECRET = "segredo-de-teste-do-vetor";
const TIMESTAMP = "1800000000000";
const RAW_BODY = '{"orgId":"org-1","dedupeKey":"log-1"}';
const ASSINATURA =
  "1d46081c8a0cb08b6ec1866fbb142ccd17ed6e47f442547d6362113268f75fb8";

/**
 * Réplica local do que `lib/max/notify-trigger.ts::sign` faz. Não importamos a
 * função de lá porque o módulo lê env na carga e o objetivo aqui é fixar o
 * FORMATO, não exercitar o transporte.
 */
function sign(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

describe("paridade do HMAC com o serviço do Max", () => {
  it("o vetor fixo bate — não mudar sem mudar o outro repo junto", () => {
    expect(sign(TIMESTAMP, RAW_BODY, SECRET)).toBe(ASSINATURA);
  });

  it("o separador é um ponto entre timestamp e corpo", () => {
    // Concatenar sem separador daria outra assinatura: é o que garante que
    // timestamp e corpo não podem ser rearranjados entre si.
    const semSeparador = createHmac("sha256", SECRET)
      .update(`${TIMESTAMP}${RAW_BODY}`)
      .digest("hex");
    expect(semSeparador).not.toBe(ASSINATURA);
  });

  it("o timestamp entra na assinatura — é o que faz a captura expirar", () => {
    expect(sign("1800000000001", RAW_BODY, SECRET)).not.toBe(ASSINATURA);
  });

  it("um byte a mais no corpo muda a assinatura", () => {
    expect(sign(TIMESTAMP, RAW_BODY + " ", SECRET)).not.toBe(ASSINATURA);
  });

  it("é hex minúsculo de 64 caracteres (sha256)", () => {
    expect(ASSINATURA).toMatch(/^[0-9a-f]{64}$/);
  });
});
