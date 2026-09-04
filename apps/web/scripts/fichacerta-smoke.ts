/**
 * apps/web/scripts/fichacerta-smoke.ts
 *
 * Smoke da conta Ficha Certa Digital de UMA org: descriptografa a credencial
 * do banco, chama `GET /solicitation/credits` e lista o webhook cadastrado lá,
 * conferindo se aponta para o nosso endpoint por slug.
 *
 * Uso (a partir de apps/web, com DATABASE_URL + MASTER_ENCRYPTION_KEY no .env):
 *   npx tsx scripts/fichacerta-smoke.ts --org <orgId>
 *
 * Imprime o host do banco como prova de ambiente. Nunca imprime a senha nem o
 * segredo do webhook (o `?k=` do endpoint sai mascarado).
 */

import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { credsFromAccount, webhookUrlForSlug } from "../src/lib/fichacerta/account";
import { getCredits, listWebhooks } from "../src/lib/fichacerta/client";

async function main() {
  const idx = process.argv.indexOf("--org");
  const orgId = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!orgId) {
    console.error("uso: npx tsx scripts/fichacerta-smoke.ts --org <orgId>");
    process.exit(2);
  }
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:]+)/)?.[1] ?? "?";
  console.log(`db host=${host}`);

  const account = await prisma.fichaCertaAccount.findUnique({ where: { orgId } });
  if (!account) {
    console.error(`[fichacerta-smoke] org ${orgId} sem conta Ficha Certa`);
    process.exit(1);
  }
  const creds = credsFromAccount(account);
  console.log(`login=${creds.login} baseUrl=${creds.baseUrl} products=${creds.products.join(",")}`);

  try {
    const credits = await getCredits(creds);
    console.log(`ok=true credits=${credits}`);
    const rows = await listWebhooks(creds);
    const expected = webhookUrlForSlug(account.webhookSlug);
    for (const r of rows) {
      const matches = typeof r.endpoint === "string" && r.endpoint.startsWith(expected);
      // O endpoint cadastrado lá carrega o segredo `?k=` — nunca imprimir em claro.
      const endpoint = (r.endpoint ?? "").replace(/([?&]k=)[^&]+/, "$1***");
      console.log(`webhook id=${r.id} endpoint=${endpoint} token_url=${r.token_url ?? "-"} matches=${matches}`);
    }
    if (rows.length === 0) console.log("webhook: NENHUM cadastrado na conta");
  } catch (err) {
    console.error("[fichacerta-smoke] FALHA:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
