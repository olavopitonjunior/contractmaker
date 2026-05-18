/**
 * Second-pass embedding pra cláusulas migradas Clause → KnowledgeItem
 * (migration 20260518120000_unify_clause_to_knowledge_item).
 *
 * Itera KnowledgeItem com category="clause" AND embedding IS NULL, gera
 * embedding via Voyage law-2 em batches de 8 e popula a coluna vector(1024).
 *
 * Standalone (sem path alias @/) pra rodar via ts-node em scripts/.
 *
 * Usage:
 *   node_modules/.bin/ts-node --transpile-only --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/embed-migrated-clauses.ts          # dry-run
 *   node_modules/.bin/ts-node --transpile-only --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/embed-migrated-clauses.ts --apply
 *
 * Env obrigatório:
 *   DATABASE_URL    — Prisma
 *   VOYAGE_API_KEY  — Voyage AI law-2 endpoint
 *
 * Custo estimado: ~50 cláusulas × ~500 tokens × $0.00012/1k ≈ $0.003 one-shot.
 */
import { PrismaClient } from "@prisma/client";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-law-2";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");
const BATCH_SIZE = 8;

interface Row {
  id: string;
  orgId: string;
  title: string;
  content: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: "document",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Voyage API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const json = (await resp.json()) as VoyageResponse;
  return json.data.map((d) => d.embedding);
}

function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function main() {
  console.log(
    DRY_RUN
      ? "[embed-migrated-clauses] DRY-RUN (passe --apply pra persistir)"
      : "[embed-migrated-clauses] APPLY mode"
  );

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error(
      "[embed-migrated-clauses] VOYAGE_API_KEY não configurada — abortando."
    );
    process.exit(1);
  }

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT id, "orgId", title, content
    FROM "KnowledgeItem"
    WHERE category = 'clause'
      AND embedding IS NULL
    ORDER BY "createdAt" ASC
    `
  );

  console.log(`[embed-migrated-clauses] Pendentes: ${rows.length}`);

  if (rows.length === 0) {
    console.log("[embed-migrated-clauses] Nada a fazer.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    for (const r of rows.slice(0, 10)) {
      console.log(`  - ${r.id} | ${r.title.slice(0, 60)}`);
    }
    if (rows.length > 10) console.log(`  … e mais ${rows.length - 10}`);
    console.log("[embed-migrated-clauses] DRY-RUN — passe --apply pra persistir.");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => `${r.title}\n\n${r.content}`);

    try {
      const vectors = await embedBatch(texts, apiKey);
      for (let j = 0; j < batch.length; j++) {
        await prisma.$executeRawUnsafe(
          `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
          toPgVector(vectors[j]),
          batch[j].id
        );
        done++;
      }
      console.log(`  [${done}/${rows.length}] batch ${i / BATCH_SIZE + 1} OK`);
    } catch (err) {
      failed += batch.length;
      console.error(
        `  [batch ${i / BATCH_SIZE + 1}] FALHOU:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`[embed-migrated-clauses] ✅ embeddings gerados: ${done}`);
  if (failed > 0) {
    console.log(`[embed-migrated-clauses] ⚠️  falhas: ${failed}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[embed-migrated-clauses] FATAL:", err);
  process.exit(1);
});
