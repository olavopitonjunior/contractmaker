/**
 * Seed da base de conhecimento do assistente de SUPORTE (KnowledgeItem
 * category="support", orgId de plataforma).
 *
 * O repo quase não tem doc voltado ao usuário, então a base inicial é conteúdo
 * curado: o FAQ (lib/support/seed-faq.ts) + o mapa de telas (lib/support/route-map.ts).
 * Cada item é taggado por módulo (geral/vendas/locacao) e embeddado via Voyage
 * quando VOYAGE_API_KEY está presente (senão, busca cai no ILIKE).
 *
 * Uso:
 *   npx tsx scripts/seed-support-kb.ts                # dry-run
 *   npx tsx scripts/seed-support-kb.ts --apply        # persiste (idempotente)
 *
 * Env:
 *   DATABASE_URL    — Prisma (passe a URL inline pra mirar staging/prod)
 *   VOYAGE_API_KEY  — opcional; se presente, gera embeddings
 *   SUPPORT_KB_ORG_ID / SHARED_ORG_ID — org que hospeda a base (fallback: org mais antiga)
 *
 * Idempotente: cada item tem um `source` estável; o script apaga o item (e seus
 * chunks, via cascade) com aquele source antes de recriar — re-rodar substitui.
 */
import { prisma } from "@/lib/db/prisma";
import { isEmbeddingsConfigured } from "@/lib/ai/embeddings";
import { collectSupportSeedItems, seedSupportKb } from "@/lib/support/seed";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Base de suporte = escopo de PLATAFORMA (orgId nulo).
  const orgId = null;
  const items = collectSupportSeedItems();
  const willEmbed = isEmbeddingsConfigured();

  console.log(
    `[seed-support-kb] orgId=${orgId} · ${items.length} itens · embeddings ${
      willEmbed ? "ON" : "OFF (ILIKE fallback)"
    } · ${APPLY ? "APLICANDO" : "dry-run"}`
  );

  if (!APPLY) {
    for (const i of items) console.log(`  - [${i.tags.join(",")}] ${i.title}  (${i.source})`);
    console.log("\nDry-run. Rode com --apply para persistir.");
    console.log(
      "Dica: em staging/prod, prefira o botão 'Semear base padrão' em /admin/support-ai\n" +
        "(roda dentro do deploy, no banco/org corretos)."
    );
    return;
  }

  const { created } = await seedSupportKb(orgId);
  console.log(`\n[seed-support-kb] concluído: ${created} itens.`);
}

main()
  .catch((e) => {
    console.error("[seed-support-kb] erro:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
