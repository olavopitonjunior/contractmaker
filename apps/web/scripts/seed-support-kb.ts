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
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { isEmbeddingsConfigured } from "@/lib/ai/embeddings";
import { SUPPORT_CATEGORY } from "@/lib/support/constants";
import { resolveSupportOrgId } from "@/lib/support/org";
import { ROUTE_MAP } from "@/lib/support/route-map";
import { SUPPORT_FAQ } from "@/lib/support/seed-faq";

const APPLY = process.argv.includes("--apply");

interface SeedItem {
  source: string;
  title: string;
  content: string;
  tags: string[];
}

function collectItems(): SeedItem[] {
  const items: SeedItem[] = [];

  for (const faq of SUPPORT_FAQ) {
    items.push({
      source: `faq:${faq.slug}`,
      title: faq.title,
      content: faq.content,
      tags: faq.tags,
    });
  }

  for (const screen of ROUTE_MAP) {
    items.push({
      source: `route:${screen.match}`,
      title: `${screen.name} — para que serve esta tela`,
      content: `${screen.purpose}\n\nO que dá pra fazer aqui: ${screen.actions.join("; ")}.`,
      tags: [screen.module],
    });
  }

  return items;
}

async function main() {
  const orgId = await resolveSupportOrgId();
  const items = collectItems();
  const willEmbed = isEmbeddingsConfigured();

  console.log(
    `[seed-support-kb] orgId=${orgId} · ${items.length} itens · embeddings ${
      willEmbed ? "ON" : "OFF (ILIKE fallback)"
    } · ${APPLY ? "APLICANDO" : "dry-run"}`
  );

  if (!APPLY) {
    for (const i of items) console.log(`  - [${i.tags.join(",")}] ${i.title}  (${i.source})`);
    console.log("\nDry-run. Rode com --apply para persistir.");
    return;
  }

  let created = 0;
  for (const i of items) {
    // Idempotência: remove versão anterior por source (chunks caem por cascade).
    await prisma.knowledgeItem.deleteMany({
      where: { orgId, category: SUPPORT_CATEGORY, source: i.source },
    });
    await createKnowledgeItem({
      orgId,
      category: SUPPORT_CATEGORY,
      title: i.title,
      content: i.content,
      tags: i.tags,
      source: i.source,
    });
    created++;
    console.log(`  ✓ ${i.title}`);
  }

  console.log(`\n[seed-support-kb] concluído: ${created} itens.`);
}

main()
  .catch((e) => {
    console.error("[seed-support-kb] erro:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
