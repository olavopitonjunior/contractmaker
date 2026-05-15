/**
 * apps/web/scripts/serasa-ping.ts
 *
 * Smoke script para validar credenciais Serasa Experian.
 *
 * Uso (a partir de apps/web):
 *   pnpm tsx scripts/serasa-ping.ts
 *
 * Lê SERASA_CLIENT_ID, SERASA_CLIENT_SECRET, SERASA_BASE_URL do .env. Faz
 * login OAuth2 fresh (sem cache), valida que devolveu accessToken + TTL,
 * e imprime tokenType + segundos restantes. Não chama nenhum endpoint
 * downstream — só a porta de entrada.
 *
 * Saída esperada em sucesso:
 *   ok=true tokenType=Bearer ttl=3540s
 *
 * Em falha, sai com exit code 1 e imprime a mensagem do SerasaError.
 */

import "dotenv/config";
import { pingSerasa, isSerasaConfigured } from "../src/lib/serasa/client";

async function main() {
  if (!isSerasaConfigured()) {
    console.error(
      "[serasa-ping] Falta SERASA_CLIENT_ID / SERASA_CLIENT_SECRET / SERASA_BASE_URL no .env"
    );
    process.exit(2);
  }
  try {
    const result = await pingSerasa();
    console.log(
      `ok=true tokenType=${result.tokenType} ttl=${result.ttlSeconds}s env=${
        process.env.SERASA_ENV ?? "?"
      }`
    );
  } catch (err) {
    console.error(
      "[serasa-ping] FALHA:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }
}

void main();
