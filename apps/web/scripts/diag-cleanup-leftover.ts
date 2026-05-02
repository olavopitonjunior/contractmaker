/**
 * Deleta um Contract específico + seu Google Doc associado.
 * Usado pra limpar resíduos de scripts de diagnóstico (diag-create-real-contract).
 *
 * Cascade do schema cobre: ContractComment, ContractSuggestion, ContractMemory,
 * ContractRevision, ContractVersion, ContractEvent, ChatSession, etc.
 *
 * Uso:
 *   npx tsx --env-file=.env.production.local scripts/diag-cleanup-leftover.ts \
 *     --contract-id <cuid> [--doc-id <id>]              # dry-run
 *   npx tsx --env-file=.env.production.local scripts/diag-cleanup-leftover.ts \
 *     --contract-id <cuid> [--doc-id <id>] --yes        # apply
 *
 * Se --doc-id for omitido, lê Contract.googleDocId.
 */
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

const prisma = new PrismaClient();

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const contractId = getArg("--contract-id");
const docIdArg = getArg("--doc-id");
const apply = process.argv.includes("--yes");

async function deleteDriveDoc(docId: string) {
  const ownerAuth = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  ownerAuth.setCredentials({ refresh_token: process.env.GOOGLE_OWNER_REFRESH_TOKEN });
  await google.drive({ version: "v3", auth: ownerAuth }).files.delete({ fileId: docId });
}

async function main() {
  if (!contractId) {
    console.error(
      "usage: npx tsx scripts/diag-cleanup-leftover.ts --contract-id <cuid> [--doc-id <id>] [--yes]"
    );
    process.exit(1);
  }

  console.log(`[diag-cleanup-leftover] ${apply ? "APPLY MODE" : "DRY RUN"}`);
  console.log(`[diag-cleanup-leftover] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`[diag-cleanup-leftover] contractId: ${contractId}`);

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      version: true,
      googleDocId: true,
      googleDocUrl: true,
      dealId: true,
      createdAt: true,
      _count: {
        select: {
          comments: true,
          suggestions: true,
          chatSessions: true,
          changeLogs: true,
          exports: true,
          clauses: true,
          childVersions: true,
        },
      },
    },
  });

  if (!contract) {
    console.error(`Contract ${contractId} não encontrado.`);
    process.exit(1);
  }

  const docId = docIdArg ?? contract.googleDocId ?? null;

  console.log("\nContract a deletar:");
  console.log(`  id:          ${contract.id}`);
  console.log(`  version:     ${contract.version}`);
  console.log(`  dealId:      ${contract.dealId}`);
  console.log(`  createdAt:   ${contract.createdAt.toISOString()}`);
  console.log(`  googleDocId: ${contract.googleDocId ?? "(null)"}`);
  console.log(`  cascade:`);
  for (const [k, v] of Object.entries(contract._count)) {
    console.log(`    ${k}: ${v}`);
  }

  console.log(`\nGoogle Doc a deletar: ${docId ?? "(nenhum)"}`);

  if (!apply) {
    console.log("\n[diag-cleanup-leftover] Re-run with --yes to actually delete.");
    return;
  }

  console.log("\n[diag-cleanup-leftover] Deletando Contract (cascade)...");
  await prisma.contract.delete({ where: { id: contractId } });
  console.log("  ✓ Contract deletado");

  if (docId) {
    console.log(`[diag-cleanup-leftover] Deletando Google Doc ${docId}...`);
    try {
      await deleteDriveDoc(docId);
      console.log("  ✓ Doc deletado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Falha ao deletar doc: ${msg}`);
      console.error("  (Contract já foi deletado do DB. Limpa o doc manualmente no Drive.)");
      process.exit(2);
    }
  }

  console.log("\n[diag-cleanup-leftover] ✓ done");
}

main()
  .catch((err) => {
    console.error("[diag-cleanup-leftover] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
