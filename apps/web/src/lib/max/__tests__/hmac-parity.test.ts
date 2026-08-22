import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signMaxAdminRequest } from "../hmac";

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
 * Segundo vetor: o formato das LEITURAS de painel (`/api/admin/*`).
 *
 * O `/notify` assina o corpo; o painel assina `método.caminho com query`,
 * porque GET não tem corpo e assinar corpo vazio deixava a query de fora do
 * HMAC — replay cross-tenant de cinco minutos.
 *
 * Este vetor não existia em repo nenhum. Os testes do cliente RECOMPUTAM a
 * assinatura com um helper local, o que pega regressão aqui dentro e **não**
 * pega divergência com o `max-agent` — que é exatamente o modo de falha que
 * este arquivo existe para matar: 401 total, silencioso, sem nenhum dos dois
 * repositórios quebrar sozinho.
 *
 * A query entra INTEIRA e na ordem em que a URL a monta. Reordenar parâmetros
 * muda a assinatura, e é por isso que o cliente assina depois de montar a URL.
 */
const ADMIN_METHOD = "GET";
const ADMIN_PATH = "/api/admin/conversations?orgId=org-1&limit=20";
const ADMIN_ASSINATURA =
  "2878ff9c3bee22542de0e4a6a26e9f27f83e1e48a0afc5936be41d5afd578ac8";

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

  it("o vetor do painel bate — mesmo contrato, outro formato", () => {
    // Passa pelo helper REAL (`signMaxAdminRequest`), e não por uma réplica:
    // aqui o objetivo é provar que a função que o cliente usa produz o valor
    // que o serviço espera.
    expect(
      signMaxAdminRequest(TIMESTAMP, ADMIN_METHOD, ADMIN_PATH, SECRET)
    ).toBe(ADMIN_ASSINATURA);
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
    // O vetor do formato admin merece a mesma guarda: um literal truncado ou
    // com maiúsculas passaria pelos testes de igualdade acima (eles comparam
    // com ele mesmo) e só falharia contra o max-agent, em produção.
    expect(ADMIN_ASSINATURA).toMatch(/^[0-9a-f]{64}$/);
  });
});
