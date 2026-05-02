/**
 * Limpa duplicatas históricas de ContractComment AI causadas pelo bug do
 * dedupeKey antigo (que incluía a mensagem da LLM — variava por phrasing,
 * não dedupava o mesmo finding repetido).
 *
 * Estratégia:
 *   1. Para cada (contractId, severity, selectedText[:200]) com 2+ AI rows,
 *      mantém a row mais antiga (createdAt asc), deleta o resto.
 *   2. Severity entra na chave porque o mesmo trecho pode ter um finding
 *      'error' (matemática) e outro 'warning' (qualificação) legítimos.
 *
 * Modos:
 *   --dry-run                  só reporta quantas seriam removidas (default)
 *   --apply                    executa o delete
 *   --contractId=<id>          escopo a 1 contrato (default: todos)
 *   --keep-resolved            mantém AI resolved=true mesmo duplicadas (default)
 *
 * Uso:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/cleanup-stale-ai-comments.ts --apply --contractId=cmons9hbh0001jl05bapg4900
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

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface Group {
  contractId: string;
  severity: string;
  trecho: string;
  ids: string[];
}

async function main() {
  const apply = flag("apply");
  const contractId = arg("contractId");
  const prisma = new PrismaClient();

  console.log(
    `Modo: ${apply ? "APPLY" : "DRY-RUN"}${contractId ? ` · contrato=${contractId}` : " · todos os contratos"}`
  );

  try {
    // Window function: numera cada row dentro do grupo por createdAt asc.
    // Tudo com rn > 1 é duplicata do mais antigo dentro de
    // (contractId, severity, LEFT(selectedText, 200)).
    const dupIds = await prisma.$queryRawUnsafe<
      Array<{ id: string; contractId: string; severity: string; trecho: string }>
    >(
      `SELECT id, "contractId", severity, trecho FROM (
         SELECT
           id,
           "contractId",
           severity,
           LEFT("selectedText", 200) AS trecho,
           ROW_NUMBER() OVER (
             PARTITION BY "contractId", severity, LEFT("selectedText", 200)
             ORDER BY "createdAt" ASC
           ) AS rn
         FROM "ContractComment"
         WHERE "authorType" = 'ai'
           AND resolved = false
           ${contractId ? `AND "contractId" = $1` : ""}
       ) ranked
       WHERE rn > 1`,
      ...(contractId ? [contractId] : [])
    );

    if (dupIds.length === 0) {
      console.log("Nada a limpar.");
      return;
    }

    // Sumário por grupo (top 15)
    const byGroup = new Map<string, number>();
    for (const r of dupIds) {
      const k = `${r.contractId.slice(-8)}|${r.severity}|${r.trecho.slice(0, 60)}`;
      byGroup.set(k, (byGroup.get(k) || 0) + 1);
    }
    const sortedGroups = Array.from(byGroup.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`\nGrupos com duplicação: ${sortedGroups.length}`);
    for (const [k, n] of sortedGroups.slice(0, 15)) {
      console.log(`  ${k}  → -${n}`);
    }

    const idsToDelete = dupIds.map((r) => r.id);
    console.log(`\nTotal a remover: ${idsToDelete.length} rows`);

    if (!apply) {
      console.log("\nDry-run — nada foi alterado. Re-execute com --apply pra deletar.");
      return;
    }

    // Delete em batches de 1000 pra não estourar query
    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += 1000) {
      const batch = idsToDelete.slice(i, i + 1000);
      const res = await prisma.contractComment.deleteMany({
        where: { id: { in: batch } },
      });
      deleted += res.count;
      console.log(`  batch ${i / 1000 + 1}: deletadas ${res.count} rows`);
    }
    console.log(`\n✓ Total deletado: ${deleted}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
