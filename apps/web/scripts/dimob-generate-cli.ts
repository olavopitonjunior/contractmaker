/**
 * Gera o TXT da DIMOB de um ano diretamente do banco (as MESMAS funções da rota
 * POST /api/dimob/generate), sem HTTP/auth. Usado no E2E de staging para provar o
 * pipeline DB→TXT ponta a ponta. Reporta pendências e escreve o arquivo para
 * inspeção/import no PGD.
 *
 * Uso: DATABASE_URL=<staging> pnpm tsx apps/web/scripts/dimob-generate-cli.ts \
 *        --orgId=<org> --year=2025 [--out <dir>]
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db/prisma";
import { aggregateSalesForYear } from "@/lib/dimob/aggregate-sales";
import { aggregateLeasesForYear } from "@/lib/dimob/aggregate-lease";
import { applyOverrides, applyLeaseOverrides, type DimobOverrideState } from "@/lib/dimob/apply-overrides";
import { validateAggregate, validateLeaseRecords, hasBlockingErrors } from "@/lib/dimob/validate";
import { buildDimobFileFromAggregate } from "@/lib/dimob/build-file";
import { DIMOB_LAYOUTS, DIMOB_LINE_SEPARATOR, DIMOB_LAYOUT_VERSION } from "@/lib/dimob/layout";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

async function main() {
  const orgId = arg("orgId") ?? process.env.SHARED_ORG_ID;
  const year = Number(arg("year") ?? "2025");
  if (!orgId) throw new Error("Passe --orgId=<id> ou SHARED_ORG_ID");
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : join(process.cwd(), "dimob-samples");

  console.log(`[dimob-gen] org=${orgId} year=${year} layout=${DIMOB_LAYOUT_VERSION}`);

  const [agg0, leaseAgg0, ov] = await Promise.all([
    aggregateSalesForYear(orgId, year),
    aggregateLeasesForYear(orgId, year),
    prisma.dimobOverride.findUnique({ where: { orgId_year: { orgId, year } } }),
  ]);
  const state = (ov?.state as DimobOverrideState) ?? null;
  const agg = applyOverrides(agg0, state);
  const leaseRecords = applyLeaseOverrides(leaseAgg0.records, state);

  const issues = [...validateAggregate(agg), ...validateLeaseRecords(leaseRecords)];
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  console.log(`Vendas incluídas: ${agg.records.length} | Locação (lease-records): ${leaseRecords.length}`);
  console.log(`Pendências: ${errors.length} bloqueiam, ${warnings.length} avisos`);
  for (const i of errors) console.log(`  ✖ [${i.scope}] ${i.field}: ${i.message}`);
  for (const i of warnings.slice(0, 10)) console.log(`  ⚠ [${i.scope}] ${i.field}: ${i.message}`);

  const built = buildDimobFileFromAggregate(agg, leaseRecords);

  // Checagem estrutural rápida (mesma ideia do txt-structure.test): larguras.
  const lines = built.txt.split(DIMOB_LINE_SEPARATOR).filter(Boolean);
  const badLen = lines.filter((l) => {
    const rec = l.slice(0, 3) as keyof typeof DIMOB_LAYOUTS;
    return !DIMOB_LAYOUTS[rec] || l.length !== DIMOB_LAYOUTS[rec].totalLength;
  });
  const byType: Record<string, number> = {};
  for (const l of lines) byType[l.slice(0, 3)] = (byType[l.slice(0, 3)] ?? 0) + 1;

  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `DIMOB_staging_${year}.txt`);
  writeFileSync(file, built.txt, "latin1");

  console.log(
    `\nRegistros: ${JSON.stringify(byType)} | recordCount=${built.recordCount}\n` +
      `totalOperacoes=${built.totalOperacoes} totalComissao=${built.totalComissao} hash=${built.contentHash.slice(0, 12)}\n` +
      `Larguras: ${badLen.length === 0 ? "todas OK ✅" : `${badLen.length} linha(s) com largura errada ✖`}\n` +
      `canGenerate(rota) = ${!hasBlockingErrors(issues) && (agg.records.length > 0 || leaseRecords.length > 0)}\n` +
      `Arquivo: ${file}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
