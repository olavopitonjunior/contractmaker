/**
 * Lista as linhas de SlaPolicy por org — o resíduo que as rodadas de auto-save
 * do SLA deixaram em staging.
 *
 * O contrato da rota é "persistimos SÓ divergências: linha = personalizado,
 * sem linha = default de código". As rodadas 1-4 gravaram linha para etapas que
 * não deveriam ter nenhuma, e o revert não as apaga — quem apaga é o botão
 * "Restaurar padrão". Este script existe para provar isso: rode antes e depois
 * de clicar no botão.
 *
 * Uso: npx tsx --env-file=<.env> scripts/diag-sla-residuo.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const linhas = await prisma.slaPolicy.findMany({
    select: {
      id: true,
      orgId: true,
      scope: true,
      key: true,
      warnDays: true,
      dangerDays: true,
      enabled: true,
      updatedAt: true,
    },
    orderBy: [{ orgId: "asc" }, { scope: "asc" }, { key: "asc" }],
  });

  console.log(`\n${linhas.length} linha(s) de SlaPolicy no banco:\n`);
  for (const l of linhas) {
    console.log(
      [
        l.orgId.slice(0, 12),
        l.scope,
        l.key.slice(0, 28).padEnd(28),
        `warn=${l.warnDays}`,
        `danger=${l.dangerDays}`,
        `enabled=${l.enabled}`,
        l.updatedAt.toISOString().slice(0, 19),
      ].join("  "),
    );
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
