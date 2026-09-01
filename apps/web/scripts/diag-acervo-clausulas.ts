/**
 * Diagnóstico READ-ONLY do acervo de cláusulas de uma org.
 *
 * Responde, sem escrever nada: quantas cláusulas existem, de que origem, quais
 * estão fora do padrão (sem esteira, sem tema, sem tags, sem notas, sem
 * embedding), quais usam chave Handlebars fora do catálogo, e quais têm PII
 * literal no texto. É o passo anterior a qualquer classificação em lote — sem
 * ele, decidir o que o classificador precisa cobrir é chute.
 *
 * Também aponta COLISÃO DE CONJUNTO DE TAGS: dois `approved` com o mesmo
 * conjunto exato. Isso é bug latente do resolvedor de slot (`rankSlotCandidates`
 * passa a ter dois candidatos empatados) e costuma ser sintoma de reingestão
 * que duplicou em vez de arquivar.
 *
 * Uso (da raiz de apps/web):
 *   npx tsx scripts/diag-acervo-clausulas.ts --org=<orgId|slug> [--json]
 *
 * Produção: o DATABASE_URL do .env aponta pra staging. Ver a memória
 * `project-contractmaker-prod-access` pro padrão com `vercel api`.
 */
import fs from "fs";
import path from "path";

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
      }
    });
}

import { PrismaClient } from "@prisma/client";
import { extractHandlebarsPaths, validateKey } from "../src/lib/clauses/key-catalog";
import { areTagsFrozen, isCanonicalTag } from "../src/lib/clauses/tag-vocabulary";
import { detectPii } from "../src/lib/ingestion/pii";
import type { FormModule } from "../src/lib/forms/presets";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function tally(values: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = v ?? "(vazio)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Mesma normalização de `ingest-clauses.ts::canonicalTagSet`. */
function tagKey(tags: string[]): string {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()))].sort().join("|");
}

async function main() {
  const orgArg = arg("org");
  const asJson = process.argv.includes("--json");
  if (!orgArg) {
    console.error("Uso: npx tsx scripts/diag-acervo-clausulas.ts --org=<orgId|slug> [--json]");
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({
    where: { OR: [{ id: orgArg }, { slug: orgArg }] },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    console.error(`Org não encontrada: ${orgArg}`);
    process.exit(1);
  }

  const rows = await prisma.knowledgeItem.findMany({
    where: { orgId: org.id, category: "clause", status: { not: "archived" } },
    select: {
      id: true,
      title: true,
      content: true,
      tags: true,
      source: true,
      esteira: true,
      groupCode: true,
      subcategory: true,
      agentNotes: true,
      isVariable: true,
      status: true,
      _count: { select: { contractClauses: true } },
    },
    orderBy: [{ source: "asc" }, { title: "asc" }],
  });

  // `embedding` não existe no client Prisma (coluna criada por SQL cru).
  const embedRows = await prisma.$queryRawUnsafe<Array<{ id: string; missing: boolean }>>(
    `SELECT id, (embedding IS NULL) AS missing FROM "KnowledgeItem"
      WHERE "orgId" = $1 AND category = 'clause' AND status <> 'archived'`,
    org.id
  );
  const semEmbedding = new Set(embedRows.filter((r) => r.missing).map((r) => r.id));

  const problemas = rows.map((c) => {
    const esteira = (c.esteira === "venda" || c.esteira === "locacao"
      ? c.esteira
      : null) as FormModule | null;

    // Sem esteira definida, valida contra as duas — o objetivo aqui é achar
    // chave que não existe em lugar nenhum, não decidir a esteira.
    const alvos: FormModule[] = esteira ? [esteira] : ["venda", "locacao"];
    const chaves = extractHandlebarsPaths(c.content);
    const chavesRuins = chaves.filter((k) =>
      alvos.every((e) => validateKey(k, e) === "rejeitada")
    );

    const pii = detectPii(c.content).map((f) => f.excerpt);
    const tagsLivres = c.tags.filter((t) => !isCanonicalTag(t));

    return {
      id: c.id,
      title: c.title,
      source: c.source,
      esteira: c.esteira,
      groupCode: c.groupCode,
      subcategory: c.subcategory,
      status: c.status,
      contratosVinculados: c._count.contractClauses,
      tagsCongeladas: areTagsFrozen({ source: c.source, tags: c.tags }),
      totalTags: c.tags.length,
      tagsLivres,
      chaves: chaves.length,
      chavesRuins,
      isVariableGravado: c.isVariable,
      isVariableDerivado: chaves.length > 0,
      semEmbedding: semEmbedding.has(c.id),
      semTags: c.tags.length === 0,
      semTema: !c.subcategory,
      semNotas: !c.agentNotes,
      pii,
    };
  });

  // Colisão de conjunto exato de tags entre cláusulas aprovadas.
  const porTagSet = new Map<string, string[]>();
  for (const c of rows) {
    if (c.status !== "approved" || c.tags.length === 0) continue;
    const k = tagKey(c.tags);
    porTagSet.set(k, [...(porTagSet.get(k) ?? []), c.title]);
  }
  const colisoes = [...porTagSet.entries()].filter(([, v]) => v.length > 1);

  const resumo = {
    org: { id: org.id, name: org.name, slug: org.slug },
    total: rows.length,
    porSource: tally(rows.map((r) => r.source)),
    porEsteira: tally(rows.map((r) => r.esteira)),
    porStatus: tally(rows.map((r) => r.status)),
    porTema: tally(rows.map((r) => r.subcategory)),
    foraDoPadrao: {
      semEsteira: problemas.filter((p) => !p.esteira).length,
      semTags: problemas.filter((p) => p.semTags).length,
      semTema: problemas.filter((p) => p.semTema).length,
      semNotas: problemas.filter((p) => p.semNotas).length,
      semEmbedding: problemas.filter((p) => p.semEmbedding).length,
      comChaveInvalida: problemas.filter((p) => p.chavesRuins.length > 0).length,
      comPii: problemas.filter((p) => p.pii.length > 0).length,
      isVariableDivergente: problemas.filter(
        (p) => p.isVariableGravado !== p.isVariableDerivado
      ).length,
    },
    colisoesDeTags: colisoes.map(([k, titles]) => ({ conjunto: k, clausulas: titles })),
  };

  if (asJson) {
    console.log(JSON.stringify({ resumo, clausulas: problemas }, null, 2));
    return;
  }

  console.log(`\n=== Acervo de cláusulas — ${org.name} (${org.id}) ===\n`);
  console.log(`Total (não arquivadas): ${resumo.total}\n`);
  console.log("Por origem:", resumo.porSource);
  console.log("Por esteira:", resumo.porEsteira);
  console.log("Por status:", resumo.porStatus);
  console.log("\nFora do padrão:", resumo.foraDoPadrao);

  if (colisoes.length > 0) {
    console.log("\n⚠ COLISÕES de conjunto exato de tags (dois approved iguais):");
    for (const { conjunto, clausulas } of resumo.colisoesDeTags) {
      console.log(`  [${conjunto}]`);
      for (const t of clausulas) console.log(`    - ${t}`);
    }
  }

  const precisamTriagem = problemas.filter(
    (p) =>
      !p.esteira ||
      p.semTags ||
      p.semTema ||
      p.semNotas ||
      p.semEmbedding ||
      p.chavesRuins.length > 0 ||
      p.pii.length > 0
  );

  if (precisamTriagem.length === 0) {
    console.log("\n✓ Nenhuma cláusula fora do padrão.\n");
    return;
  }

  console.log(`\n--- ${precisamTriagem.length} cláusula(s) fora do padrão ---\n`);
  for (const p of precisamTriagem) {
    const flags = [
      !p.esteira && "SEM ESTEIRA",
      p.semTema && "sem tema",
      p.semTags && "sem tags",
      p.semNotas && "sem notas",
      p.semEmbedding && "SEM EMBEDDING",
      p.chavesRuins.length > 0 && `chave inválida: ${p.chavesRuins.join(", ")}`,
      p.pii.length > 0 && `PII: ${p.pii.slice(0, 3).join(" | ")}`,
      p.isVariableGravado !== p.isVariableDerivado && "isVariable divergente",
      p.tagsCongeladas && "tags congeladas",
      p.contratosVinculados > 0 && `${p.contratosVinculados} contrato(s)`,
    ].filter(Boolean);
    console.log(`• ${p.title}`);
    console.log(`  id=${p.id} source=${p.source ?? "—"} esteira=${p.esteira ?? "—"}`);
    console.log(`  ${flags.join(" · ")}\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
