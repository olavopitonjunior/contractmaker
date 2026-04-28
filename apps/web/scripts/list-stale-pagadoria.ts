/**
 * One-shot helper: lista customers + charges de uma org para inspeção manual.
 * Usado pra decidir o que limpar antes de DELETE em produção.
 *
 * Uso: npx tsx scripts/list-stale-pagadoria.ts --org-id <id>
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const idx = process.argv.indexOf("--org-id");
  const orgId = idx >= 0 ? process.argv[idx + 1] : null;
  if (!orgId) {
    console.error("Use --org-id <id>");
    process.exit(1);
  }
  const p = new PrismaClient();
  try {
    const customers = await p.asaasCustomer.findMany({
      where: { orgId },
      select: {
        id: true,
        asaasId: true,
        name: true,
        cpfCnpj: true,
        createdAt: true,
        _count: { select: { charges: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const charges = await p.commissionCharge.findMany({
      where: { orgId },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        value: true,
        description: true,
        asaasCustomerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log("=== CUSTOMERS ===");
    for (const c of customers) {
      console.log(
        `  ${c.id} | ${c.asaasId} | ${c.name} | CPF=${c.cpfCnpj} | charges=${c._count.charges} | ${c.createdAt.toISOString().slice(0, 10)}`
      );
    }
    console.log("\n=== CHARGES ===");
    for (const c of charges) {
      console.log(
        `  ${c.id} | ${c.asaasPaymentId} | ${c.status} | R$ ${c.value.toFixed(2)} | "${c.description ?? ""}" | cust=${c.asaasCustomerId} | ${c.createdAt.toISOString().slice(0, 10)}`
      );
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
