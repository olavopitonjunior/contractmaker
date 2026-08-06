import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const migrations: Array<{
    migration_name: string;
    finished_at: Date | null;
  }> = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 10`
  );
  console.log("Last 10 migrations:");
  migrations.forEach((m) =>
    console.log(
      `  ${m.finished_at?.toISOString() ?? "NULL (not applied)"}  ${m.migration_name}`
    )
  );

  const hasUserIdCol: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'CertidaoJob' AND column_name = 'userId'`
  );
  console.log(`\nCertidaoJob.userId column: ${hasUserIdCol.length > 0 ? "EXISTS ✓" : "MISSING ✗"}`);

  const hasShareTable: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'CertidoesShareLink'`
  );
  console.log(`CertidoesShareLink table: ${hasShareTable.length > 0 ? "EXISTS ✓" : "MISSING ✗"}`);

  // Índice único PARCIAL do DealStageHistory (1 intervalo aberto por deal) —
  // invisível ao Prisma (vive só na migration SQL). Se um `migrate dev` futuro
  // regenerar o schema e derrubá-lo, ESTE check é o alarme.
  const hasOpenIntervalIdx: Array<{ indexname: string }> = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'DealStageHistory' AND indexname = 'DealStageHistory_open_interval_key'`
  );
  console.log(
    `DealStageHistory_open_interval_key (índice parcial): ${hasOpenIntervalIdx.length > 0 ? "EXISTS ✓" : "MISSING ✗ (recriar — ver migration 20260806170000)"}`
  );
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
