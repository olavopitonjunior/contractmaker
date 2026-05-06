/**
 * Arquiva (ou deleta, se sem contratos) templates legados — versões pré-v2
 * que ainda aparecem na lista mas não fazem mais parte do uso atual.
 *
 * Critério: rows com version="1.0.0" OU name="Compra e Venda de Imovel".
 *
 * - _count.contracts > 0 → status="archived", isDefault=false
 *   (preserva FK de contratos antigos que apontam pra row)
 * - _count.contracts === 0 → DELETE
 *
 * Usage:
 *   npx tsx scripts/archive-legacy-templates.ts             # dry-run
 *   npx tsx scripts/archive-legacy-templates.ts --apply     # persiste
 *
 * Env:
 *   DATABASE_URL — passar inline pra apontar pra prod.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(`[archive-legacy-templates] ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(`[archive-legacy-templates] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();

  const candidates = await prisma.contractTemplate.findMany({
    where: {
      OR: [{ version: "1.0.0" }, { name: "Compra e Venda de Imovel" }],
    },
    include: { _count: { select: { contracts: true } } },
  });

  if (candidates.length === 0) {
    console.log("✓ Nenhum template legado encontrado.");
    return;
  }

  let archived = 0;
  let deleted = 0;
  let skipped = 0;

  for (const t of candidates) {
    const used = t._count.contracts;
    const action =
      t.status === "archived"
        ? "skip (already archived)"
        : used > 0
        ? "archive"
        : "delete";

    console.log(
      `  ${t.id} — "${t.name}" (v${t.version}, ${t.status}, ${used} contracts) → ${action}`
    );

    if (DRY_RUN) {
      if (action === "archive") archived++;
      else if (action === "delete") deleted++;
      else skipped++;
      continue;
    }

    if (action === "archive") {
      await prisma.contractTemplate.update({
        where: { id: t.id },
        data: { status: "archived", isDefault: false },
      });
      archived++;
    } else if (action === "delete") {
      await prisma.contractTemplate.delete({ where: { id: t.id } });
      deleted++;
    } else {
      skipped++;
    }
  }

  console.log();
  console.log(
    `[archive-legacy-templates] ${DRY_RUN ? "would " : ""}archive: ${archived}, delete: ${deleted}, skip: ${skipped}`
  );
  if (DRY_RUN && (archived > 0 || deleted > 0)) {
    console.log(`[archive-legacy-templates] Run with --apply to persist.`);
  }
}

main()
  .catch((err) => {
    console.error("[archive-legacy-templates] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
