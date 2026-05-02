/**
 * Seed/fixture pra validar o banner de erro de criação do Google Doc (P0-1).
 *
 * Uso:
 *   npx ts-node apps/web/scripts/seed-gdocs-error-fixture.ts \
 *     --contractId=<id> \
 *     [--reason="timeout creating doc via Google API"]
 *
 * Sobrescreve `Contract.googleDocStatus` para "error: <reason>" e zera
 * `googleDocId` (pra ContractEditorPage cair no fallback TipTap).
 *
 * Para reverter: passe --restore-status=draft (ou rode novamente sem passar
 * a flag de error pra deixar como estava). O script imprime o estado anterior
 * antes de mudar pra você poder reverter manual via Prisma Studio se quiser.
 */

import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const contractId = arg("contractId");
  if (!contractId) {
    console.error("Uso: --contractId=<id> [--reason=<msg>] [--restore-status=draft]");
    process.exit(1);
  }
  const reason = arg("reason") || "timeout creating doc via Google API";
  const restoreStatus = arg("restore-status");

  const prisma = new PrismaClient();
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        version: true,
        status: true,
        googleDocId: true,
        googleDocStatus: true,
        googleDocUrl: true,
      },
    });
    if (!contract) {
      console.error(`Contrato ${contractId} não encontrado.`);
      process.exit(2);
    }

    console.log("Estado atual:");
    console.log(JSON.stringify(contract, null, 2));

    const newStatus = restoreStatus ? restoreStatus : `error: ${reason}`;
    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: {
        googleDocStatus: newStatus,
        // Sem googleDocId, ContractEditorPage cai no editor offline TipTap.
        // O banner amarelo lê googleDocStatus (com prefixo "error:") e renderiza.
        ...(restoreStatus ? {} : { googleDocId: null, googleDocUrl: null }),
      },
      select: {
        id: true,
        googleDocId: true,
        googleDocStatus: true,
        googleDocUrl: true,
      },
    });

    console.log("\nNovo estado:");
    console.log(JSON.stringify(updated, null, 2));
    console.log(
      restoreStatus
        ? `\n✓ Restaurado para status="${restoreStatus}". googleDocId continua null — re-criação manual via UI ou via diag-create-real-contract.ts.`
        : `\n✓ Fixture criada. Abra https://imobpro.ia.br/contracts/${contractId} e veja o banner amarelo "Editor Google Docs indisponível".`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
