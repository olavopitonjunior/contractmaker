/**
 * Phase H — heal legacy jobs
 *
 * Marks as `failed` any existing CertidaoJob where:
 *   - status === "success"
 *   - attachmentId === null
 *   - endpoint belongs to CATEGORIES_REQUIRING_PDF
 *     (civel|trabalhista|fiscal|protesto|municipal|federal)
 *
 * These are the "false-negative" rows from before the 2026-04-18 mapper
 * fix (TRF3/PGE-SP code 602 + CENPROT 200 sem PDF) — they show green "✓"
 * in the UI without documental evidence.
 *
 * Also zeroes out costCents for the same rows (H.18 — billing honesto
 * retroativo, espelha resp.header.billable).
 *
 * Run: npx tsx scripts/heal-phase-h-legacy-jobs.ts [--dry-run] [--orgId=<id>]
 */

import { prisma } from "../src/lib/db/prisma";
import {
  CATEGORIES_REQUIRING_PDF,
  endpointInfo,
} from "../src/lib/certidoes/endpoints";

interface Args {
  dryRun: boolean;
  orgId: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const orgArg = argv.find((a) => a.startsWith("--orgId="));
  const orgId = orgArg ? orgArg.split("=")[1] || null : null;
  return { dryRun, orgId };
}

async function main() {
  const { dryRun, orgId } = parseArgs();
  console.info(
    `[heal] mode=${dryRun ? "DRY-RUN" : "APPLY"} orgId=${orgId ?? "(all)"}`
  );

  const candidates = await prisma.certidaoJob.findMany({
    where: {
      status: "success",
      attachmentId: null,
      ...(orgId
        ? { deal: { form: { orgId } } }
        : {}),
    },
    select: {
      id: true,
      endpoint: true,
      costCents: true,
      label: true,
      resultData: true,
    },
  });

  const filtered = candidates.filter((c) => {
    try {
      const info = endpointInfo(c.endpoint);
      return CATEGORIES_REQUIRING_PDF.has(info.category);
    } catch {
      return false;
    }
  });

  console.info(
    `[heal] ${filtered.length}/${candidates.length} candidates match (endpoint em categoria PDF)`
  );

  if (filtered.length === 0) return;

  // Summary by endpoint
  const byEndpoint = new Map<string, number>();
  let totalCostCents = 0;
  for (const c of filtered) {
    byEndpoint.set(c.endpoint, (byEndpoint.get(c.endpoint) ?? 0) + 1);
    totalCostCents += c.costCents ?? 0;
  }
  console.info(`[heal] breakdown:`);
  for (const [endpoint, count] of byEndpoint) {
    console.info(`  ${endpoint}: ${count}`);
  }
  console.info(
    `[heal] total costCents a zerar: ${totalCostCents} (R$ ${(totalCostCents / 100).toFixed(2)})`
  );

  if (dryRun) {
    console.info("[heal] DRY-RUN — nenhuma alteração aplicada.");
    return;
  }

  const updated = await prisma.certidaoJob.updateMany({
    where: { id: { in: filtered.map((c) => c.id) } },
    data: {
      status: "failed",
      errorMessage:
        "Portal não anexou PDF — sem evidência documental (auto-healing Phase H, 2026-04-18)",
      costCents: 0,
    },
  });
  console.info(`[heal] ${updated.count} jobs updated → status=failed costCents=0`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
