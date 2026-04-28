/**
 * Manual one-shot pra rodar dispatchExternalSplits localmente contra DB de prod.
 *
 * Workaround temporário pro bug onde `void dispatchExternalSplits()` no
 * webhook handler é morto pelo serverless do Vercel quando a função
 * retorna response. Fix definitivo: await sincrono no webhook.ts ou
 * waitUntil de @vercel/functions.
 *
 * Uso: npx tsx scripts/dispatch-splits.ts --charge-id <id>
 *
 * Env: DATABASE_URL, MASTER_ENCRYPTION_KEY, ASAAS_ENV (carregar via
 * `vercel env pull .env.prod && set -a && . ./.env.prod && set +a`).
 */
import { dispatchExternalSplits } from "../src/lib/asaas/splitDispatcher";

async function main() {
  const idx = process.argv.indexOf("--charge-id");
  const id = idx >= 0 ? process.argv[idx + 1] : null;
  if (!id) {
    console.error("Use --charge-id <id>");
    process.exit(1);
  }
  console.log(`Dispatching splits for charge ${id}…`);
  const result = await dispatchExternalSplits(id);
  console.log("Result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
