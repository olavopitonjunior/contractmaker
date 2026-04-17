import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const deals = await prisma.deal.findMany({
    where: {
      OR: [
        { title: { contains: "QA", mode: "insensitive" } },
        { title: { contains: "test", mode: "insensitive" } },
        { title: { contains: "venda jardins", mode: "insensitive" } },
        { title: { contains: "regression", mode: "insensitive" } },
      ],
    },
    select: { id: true, title: true, createdAt: true, _count: { select: { certidaoJobs: true, contracts: true, attachments: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log(`${deals.length} QA-ish deals:\n`);
  for (const d of deals) {
    console.log(`  ${d.id}  "${d.title}"  (jobs:${d._count.certidaoJobs} contracts:${d._count.contracts} att:${d._count.attachments})`);
  }
  const forms = await prisma.salesForm.findMany({
    where: { OR: [{ title: { contains: "QA", mode: "insensitive" } }, { title: { contains: "test", mode: "insensitive" } }] },
    select: { id: true, title: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log(`\n${forms.length} QA-ish forms:\n`);
  for (const f of forms) console.log(`  ${f.id}  "${f.title}"  ${f.status}`);
  const notifs = await prisma.notification.count();
  console.log(`\nTotal notifications: ${notifs}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
