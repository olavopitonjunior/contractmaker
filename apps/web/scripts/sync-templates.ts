/**
 * Sync the Handlebars templates on disk with ContractTemplate.handlebarsSource
 * rows in the DB. Idempotent — only updates rows whose hash differs from the
 * on-disk version.
 *
 * Usage:
 *   npx tsx scripts/sync-templates.ts            # dry-run: prints diff, no writes
 *   npx tsx scripts/sync-templates.ts --apply    # persists changes
 *
 * Env:
 *   DATABASE_URL — Prisma connection (pass prod URL as inline env var to target prod)
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--apply");

interface TemplateFile {
  modalidade: "a_vista" | "financiamento";
  filename: string;
}

const TEMPLATES: TemplateFile[] = [
  { modalidade: "a_vista", filename: "ccv_a_vista_v2.hbs" },
  { modalidade: "financiamento", filename: "ccv_financiamento_v2.hbs" },
];

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function resolveTemplatePath(filename: string): string {
  // Try monorepo-relative first, then cwd fallbacks
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
    path.join(__dirname, "..", "..", "..", "templates", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Template file not found: ${filename}`);
}

async function main() {
  console.log(`[sync-templates] ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(`[sync-templates] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const t of TEMPLATES) {
    const filePath = resolveTemplatePath(t.filename);
    const source = fs.readFileSync(filePath, "utf-8");
    const fileHash = sha(source);

    const dbRows = await prisma.contractTemplate.findMany({
      where: { modalidade: t.modalidade, status: "active" },
      select: { id: true, orgId: true, name: true, handlebarsSource: true },
    });

    if (dbRows.length === 0) {
      console.log(`⚠  ${t.filename}: nenhum ContractTemplate ativo com modalidade=${t.modalidade}`);
      notFound++;
      continue;
    }

    for (const row of dbRows) {
      const dbHash = sha(row.handlebarsSource);
      if (dbHash === fileHash) {
        console.log(`✓  ${t.filename} [org=${row.orgId}] hash OK (${dbHash}) — skip`);
        skipped++;
        continue;
      }

      const diffLines = [];
      const fileLines = source.split("\n");
      const dbLines = row.handlebarsSource.split("\n");
      const maxLines = Math.max(fileLines.length, dbLines.length);
      let shown = 0;
      for (let i = 0; i < maxLines && shown < 5; i++) {
        if (fileLines[i] !== dbLines[i]) {
          diffLines.push(`  line ${i + 1}: DB="${(dbLines[i] || "").slice(0, 60)}" -> FILE="${(fileLines[i] || "").slice(0, 60)}"`);
          shown++;
        }
      }

      console.log(
        `⚡ ${t.filename} [org=${row.orgId}] ${dbHash} → ${fileHash} (${Math.abs(fileLines.length - dbLines.length)} lines diff)`
      );
      diffLines.forEach((l) => console.log(l));

      if (!DRY_RUN) {
        await prisma.contractTemplate.update({
          where: { id: row.id },
          data: { handlebarsSource: source },
        });
        console.log(`  ✓ updated`);
      }
      updated++;
    }
  }

  console.log();
  console.log(
    `[sync-templates] ${DRY_RUN ? "would update" : "updated"}: ${updated}, unchanged: ${skipped}, not found: ${notFound}`
  );
  if (DRY_RUN && updated > 0) {
    console.log(`[sync-templates] Run with --apply to persist changes.`);
  }
}

main()
  .catch((err) => {
    console.error("[sync-templates] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
