/**
 * Delete QA test data by title prefix. Cascades through:
 *   SalesForm → Deal → Contract → DealAttachment → CertidaoJob
 *
 * Usage:
 *   npx tsx scripts/delete-qa-data.ts --prefix "[QA E2E]"          # dry-run
 *   npx tsx scripts/delete-qa-data.ts --prefix "[QA E2E]" --yes    # apply
 *
 * Env:
 *   DATABASE_URL — Prisma connection (pass prod URL inline to target prod)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const prefix = getArg("--prefix");
const apply = process.argv.includes("--yes");

async function main() {
  if (!prefix) {
    console.error("usage: npx tsx scripts/delete-qa-data.ts --prefix '[QA E2E]' [--yes]");
    process.exit(1);
  }

  console.log(`[delete-qa-data] ${apply ? "APPLY MODE" : "DRY RUN"}`);
  console.log(`[delete-qa-data] prefix: "${prefix}"`);
  console.log(`[delete-qa-data] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();

  // Match forms by title prefix + deals by title prefix (they might diverge)
  const [forms, deals] = await Promise.all([
    prisma.salesForm.findMany({
      where: { title: { startsWith: prefix } },
      select: { id: true, title: true, deal: { select: { id: true } } },
    }),
    prisma.deal.findMany({
      where: { title: { startsWith: prefix } },
      select: {
        id: true,
        title: true,
        contracts: { select: { id: true } },
        attachments: { select: { id: true } },
        certidaoJobs: { select: { id: true } },
      },
    }),
  ]);

  const formIds = forms.map((f) => f.id);
  const dealIds = Array.from(
    new Set([...deals.map((d) => d.id), ...forms.flatMap((f) => (f.deal ? [f.deal.id] : []))])
  );

  console.log(`Forms matched: ${forms.length}`);
  forms.forEach((f) => console.log(`  - ${f.id}  "${f.title}"`));
  console.log(`Deals matched: ${deals.length}`);
  deals.forEach((d) =>
    console.log(
      `  - ${d.id}  "${d.title}"  (${d.contracts.length} contracts, ${d.attachments.length} attachments, ${d.certidaoJobs.length} certidao jobs)`
    )
  );

  if (formIds.length + dealIds.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  if (!apply) {
    console.log("\n[delete-qa-data] Run with --yes to actually delete.");
    return;
  }

  console.log("\n[delete-qa-data] Deleting in cascade order...");

  // Delete in transactional cascade. CertidaoJob → DealAttachment → Contract → Deal → SalesForm.
  await prisma.$transaction(async (tx) => {
    // Jobs reference deals via FK, and attachments via FK. Delete jobs first.
    const jobs = await tx.certidaoJob.deleteMany({
      where: { dealId: { in: dealIds } },
    });
    console.log(`  - CertidaoJob deleted: ${jobs.count}`);

    // DealAttachments
    const atts = await tx.dealAttachment.deleteMany({
      where: { dealId: { in: dealIds } },
    });
    console.log(`  - DealAttachment deleted: ${atts.count}`);

    // Contracts (contractClause, contractChangeLog, contractComment, contractSuggestion, chatSession cascade on delete)
    const contracts = await tx.contract.deleteMany({
      where: { dealId: { in: dealIds } },
    });
    console.log(`  - Contract deleted: ${contracts.count}`);

    // Deals (Deal FK on SalesForm is SET NULL, so deleting deals unlinks form)
    const delDeals = await tx.deal.deleteMany({
      where: { id: { in: dealIds } },
    });
    console.log(`  - Deal deleted: ${delDeals.count}`);

    // FormAttachments cascade on form delete, so delete forms last
    const delForms = await tx.salesForm.deleteMany({
      where: { id: { in: formIds } },
    });
    console.log(`  - SalesForm deleted: ${delForms.count}`);
  });

  console.log("\n[delete-qa-data] ✓ done");
}

main()
  .catch((err) => {
    console.error("[delete-qa-data] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
