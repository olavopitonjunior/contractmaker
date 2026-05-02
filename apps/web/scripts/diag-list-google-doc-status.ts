/**
 * Lista contratos com info de googleDocId/Status — só leitura, sem escrita.
 * Cruza com a data de deploy do commit c88ae9c5 (persistência da causa de falha).
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  const all = await prisma.contract.findMany({
    where: {
      template: { engine: "google_docs", googleTemplateDocId: { not: null } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      googleDocId: true,
      googleDocStatus: true,
      version: true,
      template: { select: { name: true } },
    },
  });

  console.log(`\nÚltimos ${all.length} contratos com template Google Docs:\n`);
  for (const c of all) {
    const has = c.googleDocId ? "OK" : "NO";
    const date = c.createdAt.toISOString().slice(0, 19).replace("T", " ");
    const status = c.googleDocStatus ?? "(null)";
    console.log(`[${has}] ${date}  ${c.id} v${c.version}  ${c.template.name}`);
    console.log(`     googleDocId:     ${c.googleDocId ?? "(null)"}`);
    console.log(`     googleDocStatus: ${status}`);
    console.log("");
  }

  const failed = all.filter((c) => !c.googleDocId);
  const withStatusError = failed.filter((c) => c.googleDocStatus?.startsWith("error:"));
  console.log(`\nResumo:`);
  console.log(`  Total inspecionados: ${all.length}`);
  console.log(`  Sem googleDocId: ${failed.length}`);
  console.log(`  Com googleDocStatus="error: ...": ${withStatusError.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
