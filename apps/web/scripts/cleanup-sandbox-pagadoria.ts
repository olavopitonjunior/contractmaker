/**
 * Limpeza de customers + cobranças sandbox que sobraram numa org migrada
 * pra produção. Estratégia: whitelist por EXCLUSÃO — deleta tudo da org
 * EXCETO os IDs hard-coded a preservar.
 *
 * Salvaguardas:
 *   1. Whitelist explícita de IDs a preservar (variáveis no topo).
 *   2. Filtro extra: NUNCA deleta charges com status RECEIVED ou CONFIRMED.
 *   3. NUNCA deleta customer que ainda tem charges (após delete das stale).
 *   4. Roda em prisma.$transaction — atomic.
 *   5. --dry-run obrigatório de fato (default: dry-run; precisa --execute pra rodar de verdade).
 *
 * Uso:
 *   npx tsx scripts/cleanup-sandbox-pagadoria.ts --org-id <id>            # dry-run (default)
 *   npx tsx scripts/cleanup-sandbox-pagadoria.ts --org-id <id> --execute  # run real
 *
 * Env: DATABASE_URL.
 */
import { PrismaClient, Prisma } from "@prisma/client";

// ═══ HARD-CODED whitelist — atualizar manualmente antes de rodar ═══
const PRESERVE_CUSTOMER_IDS = new Set<string>([
  "cmo7foo7g0001eklebia24awk", // Olavo Piton (cus_000173221857 prod)
]);
const PRESERVE_CHARGE_IDS = new Set<string>([
  "cmoj41zet0005nccwmzcv3egl", // Charge RECEIVED R$ 5,00 (QA E2E 2026-04-28)
  "cmoj52q2l000112a2e0ro4ziq", // Charge PIX R$ 5,00 com split 50% (QA E2E 2026-04-28)
]);
// Status que NUNCA podem ser deletados, mesmo se IDs não estiverem na whitelist
const PROTECTED_STATUSES = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] as const;

interface Args {
  orgId: string;
  execute: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let orgId = "";
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--org-id") orgId = args[++i];
    else if (a === "--execute") execute = true;
    else {
      console.error(`Argumento desconhecido: ${a}`);
      process.exit(1);
    }
  }
  if (!orgId) {
    console.error("Use --org-id <id>");
    process.exit(1);
  }
  return { orgId, execute };
}

async function main() {
  const { orgId, execute } = parseArgs();
  const prisma = new PrismaClient();

  try {
    // === Snapshot ANTES ===
    const customersBefore = await prisma.asaasCustomer.findMany({
      where: { orgId },
      select: {
        id: true,
        asaasId: true,
        name: true,
        cpfCnpj: true,
        _count: { select: { charges: true } },
      },
    });
    const chargesBefore = await prisma.commissionCharge.findMany({
      where: { orgId },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        value: true,
        description: true,
        asaasCustomerId: true,
      },
    });

    console.log("══ BEFORE ══");
    console.log(`  customers: ${customersBefore.length}`);
    console.log(`  charges  : ${chargesBefore.length}`);

    // === Decide o que deletar ===
    const chargesToDelete = chargesBefore.filter((c) => {
      if (PRESERVE_CHARGE_IDS.has(c.id)) return false;
      if ((PROTECTED_STATUSES as readonly string[]).includes(c.status)) return false;
      return true;
    });
    const customersToDelete = customersBefore.filter((c) => {
      if (PRESERVE_CUSTOMER_IDS.has(c.id)) return false;
      // Só deleta se TODAS as charges desse customer estão no chargesToDelete
      // (significa que após o delete não sobra ninguém referenciando ele)
      const customerCharges = chargesBefore.filter((ch) => ch.asaasCustomerId === c.id);
      const willBeOrphan = customerCharges.every((ch) => chargesToDelete.some((d) => d.id === ch.id));
      return willBeOrphan;
    });

    console.log("\n══ PLAN ══");
    console.log(`  DELETE charges (${chargesToDelete.length}):`);
    for (const c of chargesToDelete) {
      console.log(
        `    - ${c.id} | ${c.asaasPaymentId} | ${c.status} | R$ ${c.value.toFixed(2)} | "${c.description ?? ""}"`
      );
    }
    console.log(`  DELETE customers (${customersToDelete.length}):`);
    for (const c of customersToDelete) {
      console.log(`    - ${c.id} | ${c.asaasId} | ${c.name} | CPF=${c.cpfCnpj} | charges=${c._count.charges}`);
    }
    console.log("\n══ PRESERVE ══");
    const chargesPreserved = chargesBefore.filter((c) => !chargesToDelete.some((d) => d.id === c.id));
    const customersPreserved = customersBefore.filter((c) => !customersToDelete.some((d) => d.id === c.id));
    console.log(`  charges (${chargesPreserved.length}):`);
    for (const c of chargesPreserved) {
      const reason = PRESERVE_CHARGE_IDS.has(c.id)
        ? "whitelist"
        : (PROTECTED_STATUSES as readonly string[]).includes(c.status)
        ? `status=${c.status}`
        : "?";
      console.log(`    + ${c.id} | ${c.status} | R$ ${c.value.toFixed(2)} | reason=${reason}`);
    }
    console.log(`  customers (${customersPreserved.length}):`);
    for (const c of customersPreserved) {
      const reason = PRESERVE_CUSTOMER_IDS.has(c.id) ? "whitelist" : `still has charges`;
      console.log(`    + ${c.id} | ${c.name} | reason=${reason}`);
    }

    if (!execute) {
      console.log("\n--dry-run (default). Adicione --execute pra aplicar.");
      return;
    }

    // === Execução ===
    console.log("\n══ EXECUTING ══");
    await prisma.$transaction(async (tx) => {
      if (chargesToDelete.length > 0) {
        const r1 = await tx.commissionCharge.deleteMany({
          where: {
            id: { in: chargesToDelete.map((c) => c.id) },
            orgId, // double-check: garante escopo da org
            status: { notIn: PROTECTED_STATUSES as unknown as Prisma.Enumerable<string> },
          },
        });
        console.log(`  charges deleted: ${r1.count}`);
      }
      if (customersToDelete.length > 0) {
        const r2 = await tx.asaasCustomer.deleteMany({
          where: {
            id: { in: customersToDelete.map((c) => c.id) },
            orgId,
          },
        });
        console.log(`  customers deleted: ${r2.count}`);
      }
    });

    // === Snapshot DEPOIS ===
    const after = await Promise.all([
      prisma.asaasCustomer.count({ where: { orgId } }),
      prisma.commissionCharge.count({ where: { orgId } }),
    ]);
    console.log("\n══ AFTER ══");
    console.log(`  customers: ${after[0]}`);
    console.log(`  charges  : ${after[1]}`);
    console.log("\nDONE.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
