/**
 * Diagnóstico de proliferação de ContractComment AI num contrato.
 *
 * Uso:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/diag-comments.ts --contractId=<id>
 */

import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      // Suporta value sem aspas, com aspas simples ou com aspas duplas.
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if (m && !process.env[m[1]]) {
        const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
        process.env[m[1]] = value;
      }
    });
}

import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const contractId = arg("contractId");
  if (!contractId) {
    console.error("--contractId=<id> obrigatório");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const total = await prisma.contractComment.count({ where: { contractId } });
    const aiTotal = await prisma.contractComment.count({
      where: { contractId, authorType: "ai" },
    });
    const aiUnres = await prisma.contractComment.count({
      where: { contractId, authorType: "ai", resolved: false },
    });
    console.log({ total, aiTotal, aiUnres });

    // Group by selectedText prefix (potential duplicates)
    const dups = await prisma.$queryRawUnsafe<
      Array<{ trecho: string; n: bigint; severities: string }>
    >(
      `SELECT
         LEFT("selectedText", 120) as trecho,
         COUNT(*)::bigint as n,
         STRING_AGG(DISTINCT severity, ',') as severities
       FROM "ContractComment"
       WHERE "contractId"=$1 AND "authorType"='ai'
       GROUP BY LEFT("selectedText", 120)
       HAVING COUNT(*) > 1
       ORDER BY n DESC
       LIMIT 20`,
      contractId
    );
    console.log("\nTop 20 trechos com mais de 1 comentário:");
    for (const r of dups) {
      console.log(`  ${r.n}× [${r.severities}] "${r.trecho.slice(0, 80)}"`);
    }
    const totalDupRows = dups.reduce((acc, r) => acc + Number(r.n), 0);
    const wouldRemove = dups.reduce((acc, r) => acc + Number(r.n) - 1, 0);
    console.log(
      `\nTotal de rows envolvidas em duplicação: ${totalDupRows}; remover ${wouldRemove} mantendo 1 por trecho`
    );

    // Sample message texts pra ver variação por trecho
    if (dups[0]) {
      const top = dups[0];
      const samples = await prisma.contractComment.findMany({
        where: {
          contractId,
          authorType: "ai",
          selectedText: { startsWith: top.trecho.slice(0, 100) },
        },
        select: { text: true, severity: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      });
      console.log(`\nSample do trecho top "${top.trecho.slice(0, 60)}…" (${top.n} comentários):`);
      for (const s of samples) {
        console.log(
          `  [${s.severity}] ${s.createdAt.toISOString().slice(11, 19)} text="${s.text.slice(0, 100)}..."`
        );
      }
    }

    // AIUsage stats
    const usage = await prisma.aIUsage.aggregate({
      where: { contractId, operation: { in: ["passive_open", "passive_edit"] } },
      _count: true,
      _sum: { promptTokens: true, completionTokens: true, estimatedCostUsd: true },
    });
    console.log("\nAIUsage passive_*:");
    console.log({
      runs: usage._count,
      promptTokens: usage._sum?.promptTokens,
      completionTokens: usage._sum?.completionTokens,
      estimatedCostUsd: usage._sum?.estimatedCostUsd?.toString(),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
