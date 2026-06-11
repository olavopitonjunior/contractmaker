/**
 * Reset destrutivo do banco staging — TRUNCATE em todas as tabelas
 * exceto `_prisma_migrations`. Reinicia identidade. Idempotente.
 *
 * USE COM CUIDADO. Requer:
 *   1. STAGING_MODE=true no env (refuse rodar em prod)
 *   2. --yes flag (sem ele é dry-run)
 *   3. STAGING_RESET_PASSWORD env match com --password=
 *
 * Usage:
 *   STAGING_MODE=true pnpm tsx scripts/reset-staging.ts                                # dry-run
 *   STAGING_MODE=true pnpm tsx scripts/reset-staging.ts --yes --password=$STAGING_RESET_PASSWORD
 *
 * Depois roda seed-staging.ts automaticamente.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apply = process.argv.includes("--yes");
const passwordArg = process.argv.find((a) => a.startsWith("--password="))?.split("=")[1];

async function main() {
  if (process.env.STAGING_MODE !== "true") {
    console.error("[reset-staging] STAGING_MODE != true — recusando rodar fora de staging");
    process.exit(1);
  }
  const expectedPwd = process.env.STAGING_RESET_PASSWORD;
  if (!expectedPwd) {
    console.error("[reset-staging] STAGING_RESET_PASSWORD env não configurado");
    process.exit(1);
  }
  if (apply && passwordArg !== expectedPwd) {
    console.error("[reset-staging] --password incorreto");
    process.exit(1);
  }

  console.log(`[reset-staging] ${apply ? "APPLY" : "DRY RUN"}`);

  // Buscar todas as tabelas do schema public exceto _prisma_migrations
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations'`
  );
  console.log(`[reset-staging] vai truncar ${tables.length} tabelas`);
  if (!apply) {
    console.log(tables.map((t) => `  - ${t.tablename}`).join("\n"));
    return;
  }

  const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
  console.log(`[reset-staging] ✓ truncated`);

  console.log(`[reset-staging] rodando seed-staging…`);
  // Re-roda seed (idempotente)
  await import("./seed-staging");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
