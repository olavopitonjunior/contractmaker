import { createHmac } from "node:crypto";

/**
 * Assinatura das chamadas ao serviço do Max.
 *
 * Mora sozinha porque DOIS caminhos a usam (`notify-trigger.ts` e
 * `admin-client.ts`) e o formato é contrato com outro repositório: se as duas
 * pontas divergirem no que entra no HMAC, **toda** chamada passa a ser recusada
 * com 401 — e nenhum dos dois repositórios quebra sozinho. Duplicar a função
 * seria criar duas chances de divergir em vez de uma.
 *
 * O formato está travado por vetor fixo nos dois lados
 * (`lib/max/__tests__/hmac-parity.test.ts` aqui,
 * `src/lib/__tests__/hmac-parity.test.ts` no `max-agent`).
 *
 * O timestamp entra na assinatura, e não só no header, para que uma requisição
 * capturada expire junto com a janela de tolerância do outro lado.
 */
export function signMaxRequest(
  timestamp: string,
  rawBody: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export interface SignedRequest {
  headers: Record<string, string>;
  body: string;
}

/**
 * Monta corpo e headers de uma chamada assinada.
 *
 * Devolve o corpo JÁ serializado de propósito: quem chama tem que mandar
 * exatamente esta string, porque é sobre ela que a assinatura foi calculada.
 * Reserializar o objeto no `fetch` produziria outra ordem de chaves e um 401.
 */
export function signedBody(payload: unknown, secret: string): SignedRequest {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Max-Timestamp": timestamp,
      "X-Max-Signature": signMaxRequest(timestamp, body, secret),
    },
  };
}
