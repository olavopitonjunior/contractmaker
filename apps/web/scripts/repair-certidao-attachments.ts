/**
 * Repair orphan CertidaoJob rows — jobs in status=success but with no
 * linked attachment (attachmentId IS NULL). These are leftovers from before
 * FIX-A, when `uploadBufferToStorage` silently failed in serverless.
 *
 * Strategy: demote them to status=failed so the UI retry button appears.
 * Users can then retry manually from the card (costs R$0.04 per retry).
 *
 * For jobs that DO have a _rawReceipt in resultData, leave as-is — the retry
 * endpoint's re_attach branch can re-download without a new API call.
 *
 * Usage:
 *   DATABASE_URL="<prod>" npx tsx scripts/repair-certidao-attachments.ts --dry-run
 *   DATABASE_URL="<prod>" npx tsx scripts/repair-certidao-attachments.ts --deal <dealId> --yes
 *   DATABASE_URL="<prod>" npx tsx scripts/repair-certidao-attachments.ts --all --yes
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const dealId = getArg("--deal");
const all = process.argv.includes("--all");
const apply = process.argv.includes("--yes");

async function main() {
  if (!dealId && !all) {
    console.error(
      "usage: npx tsx scripts/repair-certidao-attachments.ts (--deal <id> | --all) [--yes]"
    );
    process.exit(1);
  }

  const orphans = await prisma.certidaoJob.findMany({
    where: {
      ...(dealId ? { dealId } : {}),
      status: "success",
      attachmentId: null,
    },
    select: {
      id: true,
      dealId: true,
      endpoint: true,
      label: true,
      resultData: true,
    },
  });

  console.log(`[repair] found ${orphans.length} orphan job(s)`);
  for (const j of orphans) {
    const hasReceipt =
      j.resultData &&
      typeof j.resultData === "object" &&
      "_rawReceipt" in (j.resultData as Record<string, unknown>);
    console.log(
      `  - ${j.id}  deal=${j.dealId}  endpoint=${j.endpoint}  hasReceipt=${hasReceipt}  label="${j.label}"`
    );
  }

  if (orphans.length === 0) {
    console.log("[repair] nothing to do");
    return;
  }

  if (!apply) {
    console.log("\n[repair] DRY RUN — run with --yes to apply");
    console.log(
      "[repair] action: demote to status=failed so UI retry button appears"
    );
    return;
  }

  const result = await prisma.certidaoJob.updateMany({
    where: { id: { in: orphans.map((j) => j.id) } },
    data: {
      status: "failed",
      errorMessage:
        "Comprovante nao foi salvo (bug de storage anterior). Clique em tentar novamente.",
      finishedAt: new Date(),
    },
  });

  console.log(`\n[repair] demoted ${result.count} job(s) to failed`);
  console.log(
    "[repair] users can now retry from the CertidoesTab UI (costs R$0.04 per retry)"
  );
}

main()
  .catch((err) => {
    console.error("[repair] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
