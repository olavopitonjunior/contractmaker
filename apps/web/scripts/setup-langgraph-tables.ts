#!/usr/bin/env tsx
/**
 * Setup das tabelas `langgraph_*` no Neon (PostgresSaver).
 *
 * Roda UMA VEZ por ambiente (dev, prod). O `.setup()` do PostgresSaver é
 * idempotente — pode ser re-executado sem corromper checkpoints
 * existentes.
 *
 * As tabelas criadas ficam FORA do controle do Prisma:
 *   - langgraph_checkpoints
 *   - langgraph_checkpoint_writes
 *   - langgraph_checkpoint_blobs
 *   - langgraph_versions
 *
 * Não rodar `prisma migrate dev` depois disso achando que precisa
 * "incluir" essas tabelas — o `prisma db pull` vai trazê-las pro schema
 * por engano. Ver `docs/multi-agent-architecture.md`.
 *
 * Uso:
 *   pnpm -F web tsx scripts/setup-langgraph-tables.ts
 *
 * Variáveis de ambiente:
 *   DATABASE_URL — string de conexão Postgres (mesmo Neon do Prisma)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Load .env manualmente — scripts em apps/web não usam dotenv.
function loadEnvFile(): void {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL não está definido");
    process.exit(1);
  }

  console.log("→ Conectando em Postgres…");
  const saver = PostgresSaver.fromConnString(url);

  console.log("→ Rodando setup() (idempotente)…");
  await saver.setup();

  console.log("✅ Tabelas langgraph_* criadas/atualizadas.");
  console.log("   Próximo passo: acender ENABLE_MULTI_AGENT=true após F1 estar pronto.");
}

main().catch((err) => {
  console.error("❌ setup-langgraph-tables falhou:", err);
  process.exit(1);
});
