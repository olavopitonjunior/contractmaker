/**
 * Conteúdo e semeadura da base de suporte — server-safe, reusado pelo script
 * (scripts/seed-support-kb.ts) E pelo endpoint admin (POST .../knowledge/seed).
 *
 * Semear de dentro do app (via endpoint) é o caminho confiável: usa o
 * DATABASE_URL/SHARED_ORG_ID/VOYAGE_API_KEY do próprio deploy, evitando o
 * mismatch de banco/org que acontece ao rodar o script de uma máquina local com
 * env defasado (ver memória feedback_env_staging_stale_db).
 */

import { prisma } from "@/lib/db/prisma";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { VoyageError } from "@/lib/ai/embeddings";
import { SUPPORT_CATEGORY } from "./constants";
import { SUPPORT_FAQ } from "./seed-faq";
import { ROUTE_MAP } from "./route-map";

export interface SupportSeedItem {
  source: string;
  title: string;
  content: string;
  tags: string[];
}

/** Itens da base padrão a partir do FAQ + mapa de telas (dados puros em código). */
export function collectSupportSeedItems(): SupportSeedItem[] {
  const items: SupportSeedItem[] = [];

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

/**
 * Popula (idempotente) a base de suporte no `orgId` dado. Remove a versão
 * anterior por `source` (chunks caem por cascade) e recria. O embedding é
 * best-effort: sem VOYAGE_API_KEY (ou se o Voyage falhar) o conteúdo entra
 * mesmo assim e a busca cai no ILIKE.
 */
export async function seedSupportKb(
  orgId: string,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: number }> {
  const items = collectSupportSeedItems();
  let created = 0;

  for (const item of items) {
    await prisma.knowledgeItem.deleteMany({
      where: { orgId, category: SUPPORT_CATEGORY, source: item.source },
    });
    try {
      await createKnowledgeItem({
        orgId,
        category: SUPPORT_CATEGORY,
        title: item.title,
        content: item.content,
        tags: item.tags,
        source: item.source,
        createdBy: opts.createdBy ?? null,
      });
    } catch (e) {
      // Best-effort: `createKnowledgeItem` cria a linha ANTES de embutir, então
      // um erro do Voyage deixa o item pesquisável via ILIKE — só sem embedding.
      // Seguimos pro próximo em vez de abortar o seed inteiro.
      if (e instanceof VoyageError) {
        console.error("[seedSupportKb] embedding falhou (item segue via ILIKE):", e.message);
      } else {
        throw e;
      }
    }
    created++;
  }

  return { created };
}
