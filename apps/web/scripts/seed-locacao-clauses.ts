/**
 * Seed do banco de cláusulas de LOCAÇÃO (KnowledgeItem category="clause").
 *
 * Contexto (bug #6 do QA de locação 2026-06-06): a base de cláusulas não tinha
 * NENHUMA cláusula de locação, então `insert_clause` / auto-resolve (Voyage ou
 * ILIKE) nunca encontrava nada para pedidos como "vistoria de entrada", e o
 * ciclo de padronização (propose_*) ficava sem matéria-prima. Este seed insere
 * um conjunto curado de cláusulas da Lei nº 8.245/91 com títulos/tags ricos em
 * palavras-chave (para o fallback ILIKE) e embeddings Voyage quando disponível.
 *
 * Locação não usa os grupos G1..G6 (sistema de venda) — usamos `subcategory`
 * semântica e `tags`. groupCode fica null.
 *
 * Uso:
 *   npx tsx scripts/seed-locacao-clauses.ts                 # dry-run
 *   npx tsx scripts/seed-locacao-clauses.ts --apply         # persiste
 *   npx tsx scripts/seed-locacao-clauses.ts --apply --orgId=<id>
 *
 * Env:
 *   DATABASE_URL  — Prisma (passe a URL de staging inline pra mirar staging)
 *   VOYAGE_API_KEY — opcional; se presente, gera embeddings (senão, ILIKE)
 *   SHARED_ORG_ID  — fallback de orgId quando --orgId não é passado
 *
 * Idempotente: pula/atualiza cláusula já existente por (orgId, title).
 */
import { PrismaClient } from "@prisma/client";
import { LOCACAO_SEED_CLAUSES as CLAUSES } from "@/lib/knowledge/seed-clauses-locacao";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

async function embedVoyage(text: string): Promise<number[] | null> {
  if (!VOYAGE_KEY) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VOYAGE_KEY}`,
      },
      body: JSON.stringify({ model: "voyage-law-2", input: [text], input_type: "document" }),
    });
    if (!res.ok) {
      console.warn(`  [voyage] HTTP ${res.status} — pulando embedding`);
      return null;
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === 1024 ? vec : null;
  } catch (e) {
    console.warn(`  [voyage] erro: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function resolveOrgId(): Promise<string | null> {
  if (ORG_ARG) return ORG_ARG.split("=")[1];
  if (process.env.SHARED_ORG_ID) return process.env.SHARED_ORG_ID;
  // Fallback: org dona dos templates de locação (auto-mira o ambiente certo).
  const tmpl = await prisma.contractTemplate.findFirst({
    where: { modalidade: { in: ["locacao", "locacao_comercial"] } },
    select: { orgId: true },
  });
  return tmpl?.orgId ?? null;
}

async function main() {
  console.log(`[seed-locacao-clauses] ${APPLY ? "APPLY" : "DRY RUN"}`);
  const orgId = await resolveOrgId();
  if (!orgId) {
    console.error(
      "[seed-locacao-clauses] orgId não resolvido. Passe --orgId=<id> ou SHARED_ORG_ID, ou garanta que existam templates de locação."
    );
    process.exit(1);
  }
  console.log(`[seed-locacao-clauses] org=${orgId} · voyage=${VOYAGE_KEY ? "ON" : "OFF (ILIKE)"}`);

  let created = 0;
  let skipped = 0;
  let embedded = 0;

  for (const c of CLAUSES) {
    const existing = await prisma.knowledgeItem.findFirst({
      where: { orgId, category: "clause", title: c.title },
      select: { id: true },
    });
    if (existing) {
      console.log(`= já existe: ${c.title}`);
      skipped++;
      continue;
    }
    console.log(`${APPLY ? "+" : "·"} ${c.title} [${c.subcategory}]`);
    if (!APPLY) {
      created++;
      continue;
    }
    const item = await prisma.knowledgeItem.create({
      data: {
        orgId,
        category: "clause",
        title: c.title,
        content: c.content,
        chunkIndex: 0,
        chunkTotal: 1,
        tags: ["locacao", ...c.tags.filter((t) => t !== "locacao")],
        source: "seed_locacao_v1",
        agentNotes: c.agentNotes,
        groupCode: null,
        subcategory: c.subcategory,
        isVariable: c.isVariable,
        status: "approved",
        usageCount: 0,
      },
      select: { id: true },
    });
    created++;
    // Embedding Voyage (best-effort) — vital quando o ambiente TEM Voyage, pois
    // a busca vetorial filtra `embedding IS NOT NULL` (sem embedding a cláusula
    // ficaria invisível ao auto-resolve). Sem Voyage, o app usa ILIKE.
    const vec = await embedVoyage(`${c.title}\n${c.content}`);
    if (vec) {
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
        `[${vec.join(",")}]`,
        item.id
      );
      embedded++;
    }
  }

  console.log(
    `\n[seed-locacao-clauses] ${APPLY ? "criadas" : "seriam criadas"}: ${created}, já existentes: ${skipped}, com embedding: ${embedded}`
  );
  if (!APPLY) console.log("[seed-locacao-clauses] rode com --apply para persistir.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
