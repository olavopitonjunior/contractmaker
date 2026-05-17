#!/usr/bin/env tsx
/**
 * apps/web/scripts/voyage-ping.ts
 *
 * Smoke script para validar a `VOYAGE_API_KEY` configurada.
 *
 * Faz uma embedding mínima (1 token) com `voyage-law-2`. Em sucesso devolve
 * `ok=true ttl=ok dims=1024`. Em falha, exit 1 + mensagem do VoyageError.
 *
 * Uso:
 *   cd apps/web && npx tsx scripts/voyage-ping.ts
 *
 * Custo: ~$0.00001 por execução (1 token a $0.12/M tokens).
 *
 * Quando rotacionar a chave:
 *   1. Gere nova chave em https://dash.voyageai.com (Settings → API Keys)
 *   2. Anote o ID antigo (mantém ativa em paralelo durante o rollover)
 *   3. Atualize Vercel env: `printf 'NEW_KEY' | vercel env add VOYAGE_API_KEY production`
 *   4. Redeploy
 *   5. Rode este script contra prod via `vercel env pull && npx tsx scripts/voyage-ping.ts`
 *   6. Verifique sucesso → revogue chave antiga no painel Voyage
 *
 * Em falha persistente (401), fallback ILIKE em query_knowledge_base e
 * fingerprint em find_similar_contracts continua funcionando, mas a qualidade
 * RAG semântica degrada (verifica `[query_knowledge_base] fallback acionado`
 * em logs).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

import { embed, isEmbeddingsConfigured, VoyageError } from "../src/lib/ai/embeddings";

async function main() {
  if (!isEmbeddingsConfigured()) {
    console.error("[voyage-ping] VOYAGE_API_KEY não está configurada no .env");
    process.exit(2);
  }

  const t0 = Date.now();
  try {
    const vectors = await embed(["ping"], "document");
    if (!Array.isArray(vectors) || vectors.length === 0 || !Array.isArray(vectors[0])) {
      console.error("[voyage-ping] Resposta inválida — esperava array de 1 vector");
      process.exit(1);
    }
    const dims = vectors[0].length;
    if (dims !== 1024) {
      console.error(`[voyage-ping] Dimensões inesperadas — esperava 1024, recebeu ${dims}`);
      process.exit(1);
    }
    console.log(`✅ ok=true dims=${dims} latency=${Date.now() - t0}ms`);
    console.log(`   Modelo: voyage-law-2 (input_type=document)`);
    console.log(`   Chave OK — RAG semântico funcional em prod.`);
  } catch (err) {
    if (err instanceof VoyageError) {
      console.error(`❌ VoyageError: ${err.message}`);
      console.error(`   Provável causa: chave expirou ou foi revogada.`);
      console.error(`   Rotacione em https://dash.voyageai.com`);
    } else {
      console.error(`❌ Falha inesperada:`, err);
    }
    process.exit(1);
  }
}

main();
