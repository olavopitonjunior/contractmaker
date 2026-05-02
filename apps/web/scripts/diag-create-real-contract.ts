// Roda via: node --env-file=.env -r ts-node/register/transpile-only -e "require('./scripts/diag-create-real-contract.ts')"
// OU: setar DATABASE_URL no shell + npx ts-node ...
import { PrismaClient } from "@prisma/client";
import { generateContractForDeal } from "../src/lib/services/contract-generation";

async function main() {
  const prisma = new PrismaClient();

  // Pega um deal existente em estado pré-contrato (sem contract recente)
  const deal = await prisma.deal.findFirst({
    where: {
      title: { contains: "[QA-GDOCS]" },
    },
    orderBy: { createdAt: "desc" },
    include: { pipeline: { select: { orgId: true } } },
  });

  if (!deal) {
    console.log("Nenhum deal QA-GDOCS encontrado.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Deal: ${deal.id} ${deal.title}`);
  console.log(`Org: ${deal.pipeline?.orgId}`);

  console.log("\nChamando generateContractForDeal (SEM catch silencioso)...");
  const result = await generateContractForDeal(
    deal.id,
    deal.userId,
    deal.pipeline!.orgId
  );

  console.log("RESULT:", result);

  if (result.googleDocUrl) {
    console.log(`✓ googleDocUrl populado: ${result.googleDocUrl}`);
  } else {
    console.log("✗ googleDocUrl NULL — feature não disparou ou falhou silenciosamente");
  }

  // Confirmar no banco
  const persisted = await prisma.contract.findUnique({
    where: { id: result.contractId },
    select: { id: true, googleDocId: true, googleDocUrl: true, version: true },
  });
  console.log("\nPersistido no DB:", persisted);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\nERRO:");
  console.error("  message:", err.message);
  console.error("  stack:", err.stack);
  process.exit(1);
});
