/**
 * Fix one-shot: as duas rows v2 ativas em prod estão com engine="google_docs"
 * por herança do fluxo legacy pré-2026-05-05. O código atual ignora esse
 * campo e renderiza via Handlebars (por isso prod funciona). O novo código
 * (em deploy) PASSA a respeitar o engine, então precisa ser corrigido pra
 * "handlebars" antes do push pra não quebrar a esteira.
 *
 * Critério: engine="google_docs" + status="active" + version="2.0.0" — só
 * pega exatamente os dois CCV Zimmermann v2.
 *
 * Usage:
 *   npx tsx scripts/fix-v2-engine.ts            # dry-run
 *   npx tsx scripts/fix-v2-engine.ts --apply    # persiste
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(`[fix-v2-engine] ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(
    `[fix-v2-engine] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`
  );
  console.log();

  const targets = await prisma.contractTemplate.findMany({
    where: {
      engine: "google_docs",
      status: "active",
      version: "2.0.0",
    },
    select: {
      id: true,
      name: true,
      modalidade: true,
      isDefault: true,
      engine: true,
    },
  });

  if (targets.length === 0) {
    console.log("✓ Nenhuma row em estado inconsistente.");
    return;
  }

  console.log(`Rows que vão receber engine='handlebars':`);
  for (const t of targets) {
    console.log(
      `  ${t.id} — "${t.name}" (modalidade=${t.modalidade}, isDefault=${t.isDefault})`
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log(
      `[fix-v2-engine] would update: ${targets.length} (rode com --apply pra persistir)`
    );
    return;
  }

  const result = await prisma.contractTemplate.updateMany({
    where: {
      engine: "google_docs",
      status: "active",
      version: "2.0.0",
    },
    data: { engine: "handlebars" },
  });

  console.log(`[fix-v2-engine] updated: ${result.count}`);
}

main()
  .catch((err) => {
    console.error("[fix-v2-engine] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
