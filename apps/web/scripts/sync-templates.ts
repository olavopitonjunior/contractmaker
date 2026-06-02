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
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--apply");
const SEED = process.argv.includes("--seed");
const UPDATE_METADATA = process.argv.includes("--update-metadata");

interface TemplateFile {
  modalidade: "a_vista" | "financiamento" | "locacao" | "locacao_comercial";
  filename: string;
  canonicalName: string;
  canonicalDescription: string;
  // schemaType da row criada no --seed (default compra_venda_v2 p/ venda).
  schemaType?: string;
}

const TEMPLATES: TemplateFile[] = [
  {
    modalidade: "a_vista",
    filename: "ccv_a_vista_v2.hbs",
    canonicalName: "CCV - Pagamento À Vista",
    canonicalDescription:
      "Instrumento particular de compromisso de venda e compra - modalidade pagamento à vista",
  },
  {
    modalidade: "financiamento",
    filename: "ccv_financiamento_v2.hbs",
    canonicalName: "CCV - Financiamento Imobiliário",
    canonicalDescription:
      "Instrumento particular de compromisso de venda e compra - modalidade financiamento imobiliário",
  },
  {
    modalidade: "locacao",
    filename: "locacao_residencial_v2.hbs",
    canonicalName: "Locação Residencial",
    canonicalDescription:
      "Instrumento particular de contrato de locação residencial - Lei nº 8.245/91",
    schemaType: "locacao_residencial_v1",
  },
  {
    modalidade: "locacao_comercial",
    filename: "locacao_comercial_v2.hbs",
    canonicalName: "Locação Comercial",
    canonicalDescription:
      "Instrumento particular de contrato de locação não residencial (comercial) - Lei nº 8.245/91",
    schemaType: "locacao_comercial_v1",
  },
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

  for (const t of TEMPLATES) {
    const filePath = resolveTemplatePath(t.filename);
    const source = fs.readFileSync(filePath, "utf-8");
    const fileHash = sha(source);

    const dbRows = await prisma.contractTemplate.findMany({
      where: { modalidade: t.modalidade, status: "active" },
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

      if (SEED) {
        // Sem orgId disponível, não podemos criar — precisa rodar por org.
        // Buscamos todas as orgs e seedamos uma row por org pra essa modalidade.
        const orgs = await prisma.organization.findMany({ select: { id: true } });
        for (const org of orgs) {
          const exists = await prisma.contractTemplate.findFirst({
            where: { orgId: org.id, modalidade: t.modalidade, status: "active" },
            select: { id: true },
          });
          if (exists) continue;

          // Desfaz isDefault de outros templates da mesma modalidade pra essa org
          // antes de criar — invariant "um default por (org, modalidade)".
          if (!DRY_RUN) {
            await prisma.contractTemplate.updateMany({
              where: { orgId: org.id, modalidade: t.modalidade, isDefault: true },
              data: { isDefault: false },
            });
            await prisma.contractTemplate.create({
              data: {
                orgId: org.id,
                name: t.canonicalName,
                description: t.canonicalDescription,
                handlebarsSource: source,
                modalidade: t.modalidade,
                isDefault: true,
                status: "active",
                schemaType: t.schemaType ?? "compra_venda_v2",
                version: "2.0.0",
                engine: "handlebars",
              },
            });
            console.log(`  ✓ seeded org=${org.id} → ${t.canonicalName}`);
          } else {
            console.log(`  [seed] would create for org=${org.id} → ${t.canonicalName}`);
          }
          seeded++;
        }
      }
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
