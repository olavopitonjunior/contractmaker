/**
 * Backfill: garante permission `anyone with link` em todos os Contract.googleDocId
 * existentes. Necessário 1x após o deploy de `ensureAnyonePermission` — docs
 * criados antes não têm a permission e ainda mostram "Solicitar acesso" no
 * iframe quando o user está logado no Chrome com conta Google diferente.
 *
 * Role aplicada:
 *   - status === "aprovado" → reader (alinhado com makeDocReadOnly da aprovação)
 *   - demais → writer
 *
 * Uso:
 *   npx tsx apps/web/scripts/backfill-anyone-permission.ts            # dry-run
 *   npx tsx apps/web/scripts/backfill-anyone-permission.ts --apply    # executa
 *   npx tsx apps/web/scripts/backfill-anyone-permission.ts --apply --limit=50
 *
 * Idempotente: `ensureAnyonePermission` lista permissions primeiro e só
 * cria/atualiza quando necessário.
 */

import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { prisma } from "../src/lib/db/prisma";
import { ensureAnyonePermission } from "../src/lib/google/share-org";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = arg("limit");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;

  const contracts = await prisma.contract.findMany({
    where: { googleDocId: { not: null } },
    select: { id: true, googleDocId: true, status: true, version: true },
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
  });

  console.log(
    `[backfill-anyone] Encontrados ${contracts.length} contratos com googleDocId. ${
      apply ? "Aplicando…" : "(dry-run — passe --apply pra executar)"
    }`
  );

  let success = 0;
  let failed = 0;
  for (const c of contracts) {
    if (!c.googleDocId) continue;
    const role: "writer" | "reader" =
      c.status === "aprovado" ? "reader" : "writer";

    if (!apply) {
      console.log(`  · ${c.id} v${c.version} (${c.status}) → anyone=${role}`);
      continue;
    }

    try {
      await ensureAnyonePermission(c.googleDocId, role);
      success++;
      console.log(`  ✓ ${c.id} v${c.version} → anyone=${role}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${c.id}: ${msg.slice(0, 200)}`);
    }
  }

  if (apply) {
    console.log(
      `\n[backfill-anyone] Concluído. Sucesso: ${success} · Falhas: ${failed}`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-anyone] Crashou:", err);
  process.exit(1);
});
