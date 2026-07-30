/**
 * Sync the Handlebars templates on disk with ContractTemplate.handlebarsSource
 * rows in the DB. Idempotent — only updates rows whose hash differs from the
 * on-disk version.
 *
 * Usage:
 *   npx tsx scripts/sync-templates.ts                            # dry-run
 *   npx tsx scripts/sync-templates.ts --apply                    # persists handlebarsSource updates
 *   npx tsx scripts/sync-templates.ts --apply --seed             # also creates rows that don't exist
 *   npx tsx scripts/sync-templates.ts --apply --update-metadata  # also updates name/description
 *   npx tsx scripts/sync-templates.ts --apply --seed --update-metadata
 *
 * Env:
 *   DATABASE_URL — Prisma connection (pass prod URL as inline env var to target prod)
 *
 * Os metadados dos templates canônicos e a criação de row vivem em
 * `src/lib/templates/canonical-templates.ts` / `canonical-seed.ts` (fonte única,
 * compartilhada com o seed automático de `POST /api/admin/orgs`). Este script é
 * a via de UPDATE de conteúdo (`--apply`) + backfill de orgs antigas (`--seed`).
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  CANONICAL_TEMPLATES as TEMPLATES,
  canonicalModalidadesForModules,
  type CanonicalTemplate,
} from "../src/lib/templates/canonical-templates";
import {
  seedCanonicalTemplatesForOrg,
  type CanonicalSeedClient,
} from "../src/lib/templates/canonical-seed";

const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--apply");
const SEED = process.argv.includes("--seed");
const UPDATE_METADATA = process.argv.includes("--update-metadata");

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
  if (SEED) console.log(`[sync-templates] --seed enabled (cria rows ausentes)`);
  if (UPDATE_METADATA)
    console.log(`[sync-templates] --update-metadata enabled (atualiza name/description)`);
  console.log(`[sync-templates] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  let seeded = 0;
  let renamed = 0;

  // Pass de seed por ORG — roda SEMPRE que --seed é passado. Antes vivia dentro
  // do `if (dbRows.length === 0)` do loop de templates, então só disparava
  // quando NENHUMA org do banco tinha a modalidade: bastava uma org antiga ter
  // o template pra todo tenant novo ficar sem nenhum e a primeira geração
  // morrer em "Nenhum template ativo".
  if (SEED) {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    for (const org of orgs) {
      // Escopo por MÓDULO habilitado: um tenant só-locação não deve ganhar CCV
      // à vista/financiamento num backfill. Org SEM rows de OrgModule = org
      // anterior à modularização → semeia tudo (comportamento legado, que é
      // também o fail-open de lib/modules/read.ts).
      const orgModules = await prisma.orgModule.findMany({
        where: { orgId: org.id, enabled: true },
        select: { module: true },
      });
      const hasModuleRows =
        (await prisma.orgModule.count({ where: { orgId: org.id } })) > 0;
      const onlyModalidades = hasModuleRows
        ? canonicalModalidadesForModules(orgModules.map((m) => m.module))
        : undefined;

      const { created, skipped: seedSkipped } = await seedCanonicalTemplatesForOrg(org.id, {
        db: prisma as unknown as CanonicalSeedClient,
        // CLI lê do disco (fonte da verdade local), não do módulo embarcado.
        loadSource: (t: CanonicalTemplate) =>
          fs.readFileSync(resolveTemplatePath(t.filename), "utf-8"),
        dryRun: DRY_RUN,
        onlyModalidades,
      });
      if (created.length > 0) {
        console.log(
          `${DRY_RUN ? "[seed] would create" : "  ✓ seeded"} org=${org.id} (${org.name}): ` +
            created.join(", ")
        );
      } else {
        console.log(`↷  seed org=${org.id} (${org.name}): nada a criar (${seedSkipped.length} ok)`);
      }
      seeded += created.length;
    }
    console.log();
  }

  for (const t of TEMPLATES) {
    const filePath = resolveTemplatePath(t.filename);
    const source = fs.readFileSync(filePath, "utf-8");
    const fileHash = sha(source);

    // Guard multitenant: templates engine="google_docs" são o MODELO da
    // imobiliária (Doc no Drive do tenant) — o sync de .hbs canônicos NUNCA
    // pode sobrescrevê-los.
    const gdocsRows = await prisma.contractTemplate.count({
      where: { modalidade: t.modalidade, status: "active", engine: "google_docs" },
    });
    if (gdocsRows > 0) {
      console.log(
        `↷  ${t.filename}: skip de ${gdocsRows} row(s) engine=google_docs (modelo do tenant) em modalidade=${t.modalidade}`
      );
    }

    const dbRows = await prisma.contractTemplate.findMany({
      where: { modalidade: t.modalidade, status: "active", engine: "handlebars" },
      select: {
        id: true,
        orgId: true,
        name: true,
        description: true,
        handlebarsSource: true,
      },
    });

    if (dbRows.length === 0) {
      console.log(`⚠  ${t.filename}: nenhum ContractTemplate ativo com modalidade=${t.modalidade}`);
      notFound++;
      continue;
    }

    for (const row of dbRows) {
      const dbHash = sha(row.handlebarsSource);

      // 1) Atualiza handlebarsSource se hash difere
      if (dbHash !== fileHash) {
        const fileLines = source.split("\n");
        const dbLines = row.handlebarsSource.split("\n");
        console.log(
          `⚡ ${t.filename} [org=${row.orgId}] ${dbHash} → ${fileHash} (${Math.abs(fileLines.length - dbLines.length)} lines diff)`
        );
        if (!DRY_RUN) {
          await prisma.contractTemplate.update({
            where: { id: row.id },
            data: { handlebarsSource: source },
          });
          console.log(`  ✓ source updated`);
        }
        updated++;
      } else {
        console.log(`✓  ${t.filename} [org=${row.orgId}] hash OK (${dbHash})`);
        skipped++;
      }

      // 2) Se --update-metadata: atualiza name/description quando difere
      if (
        UPDATE_METADATA &&
        (row.name !== t.canonicalName || row.description !== t.canonicalDescription)
      ) {
        console.log(
          `  ✏  metadata: "${row.name}" → "${t.canonicalName}"`
        );
        if (!DRY_RUN) {
          await prisma.contractTemplate.update({
            where: { id: row.id },
            data: {
              name: t.canonicalName,
              description: t.canonicalDescription,
            },
          });
          console.log(`  ✓ metadata updated`);
        }
        renamed++;
      }
    }
  }

  console.log();
  console.log(
    `[sync-templates] ${DRY_RUN ? "would update" : "updated"}: ${updated}, unchanged: ${skipped}, not found: ${notFound}, seeded: ${seeded}, renamed: ${renamed}`
  );
  if (DRY_RUN && (updated > 0 || seeded > 0 || renamed > 0)) {
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
