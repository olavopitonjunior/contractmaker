/**
 * Conta entradas recentes de CLICKSIGN_SETTINGS_UPDATED no AuditLog.
 *
 * O split wrapper/editor do `SignaturePreferencesForm` existe para que abrir a
 * tela NÃO dispare PATCH: montar o hook antes do GET fazia a baseline nascer
 * vazia e, quando os dados chegavam, 6-8 campos pareciam sujos — saía uma
 * gravação sem ninguém ter tocado em nada, deixando rastro no audit log de uma
 * tela sensível.
 *
 * O Network prova o instante; o audit log prova o que ficou. Rode antes e
 * depois de abrir a tela.
 *
 * Uso: npx tsx --env-file=<.env> scripts/diag-audit-clicksign.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const desde = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const linhas = await prisma.auditLog.findMany({
    where: { action: "CLICKSIGN_SETTINGS_UPDATED", createdAt: { gte: desde } },
    select: { id: true, createdAt: true, userId: true, result: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  console.log(
    `\nCLICKSIGN_SETTINGS_UPDATED nas últimas 2h: ${linhas.length}\n`,
  );
  for (const l of linhas) {
    console.log(
      `  ${l.createdAt.toISOString().slice(0, 19)}  ${l.result}  user=${(l.userId ?? "—").slice(0, 12)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
