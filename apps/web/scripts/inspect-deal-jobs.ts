import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const idx = process.argv.indexOf("--deal");
  const dealId = idx >= 0 ? process.argv[idx + 1] : null;
  if (!dealId) {
    console.error("usage: npx tsx scripts/inspect-deal-jobs.ts --deal <id>");
    process.exit(1);
  }
  const jobs = await prisma.certidaoJob.findMany({
    where: { dealId },
    select: {
      id: true,
      endpoint: true,
      label: true,
      status: true,
      attachmentId: true,
      errorMessage: true,
      retryCount: true,
      startedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${jobs.length} jobs for deal ${dealId}\n`);
  for (const j of jobs) {
    console.log(
      `  [${j.status.padEnd(15)}] ${j.endpoint.padEnd(35)} att=${j.attachmentId ?? "—"}  retry=${j.retryCount}`
    );
    if (j.errorMessage) {
      console.log(`    err: ${j.errorMessage.slice(0, 120)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
