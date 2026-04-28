import { PrismaClient } from "@prisma/client";

async function main() {
  const idx = process.argv.indexOf("--charge-id");
  const chargeId = idx >= 0 ? process.argv[idx + 1] : null;
  if (!chargeId) {
    console.error("Use --charge-id <id>");
    process.exit(1);
  }
  const p = new PrismaClient();
  try {
    const transfers = await p.asaasTransfer.findMany({
      where: { commissionChargeId: chargeId },
    });
    console.log(JSON.stringify(transfers, null, 2));
  } finally {
    await p.$disconnect();
  }
}
main().catch(console.error);
