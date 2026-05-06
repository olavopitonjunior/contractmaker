/**
 * Lista o estado de todas as ContractTemplate rows + matching contra os
 * arquivos .hbs no filesystem. Read-only — não muda nada no DB.
 *
 * Usage:
 *   npx tsx scripts/audit-templates.ts
 *
 * Env:
 *   DATABASE_URL — passar inline pra apontar pra prod.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function resolveTemplatePath(filename: string): string | null {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
    path.join(__dirname, "..", "..", "..", "templates", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  const fileShas: Record<string, string | null> = {};
  for (const fname of ["ccv_a_vista_v2.hbs", "ccv_financiamento_v2.hbs"]) {
    const p = resolveTemplatePath(fname);
    fileShas[fname] = p ? sha(fs.readFileSync(p, "utf-8")) : null;
  }

  console.log(`[audit-templates] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();
  console.log("Filesystem hashes:");
  for (const [k, v] of Object.entries(fileShas)) {
    console.log(`  ${k}: ${v || "(missing)"}`);
  }
  console.log();

  // Select explícito (sem previewSourceHash/previewUpdatedAt) para o caso de
  // a migration nova ainda não ter sido aplicada — assim a auditoria roda
  // contra qualquer estado intermediário sem dar P2022.
  const rows = await prisma.contractTemplate.findMany({
    select: {
      id: true,
      orgId: true,
      name: true,
      modalidade: true,
      version: true,
      isDefault: true,
      status: true,
      engine: true,
      handlebarsSource: true,
      updatedAt: true,
      _count: { select: { contracts: true } },
    },
    orderBy: [
      { orgId: "asc" },
      { isDefault: "desc" },
      { modalidade: "asc" },
      { createdAt: "desc" },
    ],
  });

  console.log(`Total ContractTemplate rows: ${rows.length}`);
  console.log();

  const header = [
    "id",
    "orgId",
    "name",
    "modalidade",
    "version",
    "isDefault",
    "status",
    "engine",
    "sourceSha",
    "matchesFs",
    "contracts",
    "updatedAt",
  ];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");

  for (const r of rows) {
    const srcSha = sha(r.handlebarsSource);
    const expectedFile =
      r.modalidade === "financiamento"
        ? "ccv_financiamento_v2.hbs"
        : "ccv_a_vista_v2.hbs";
    const matches = fileShas[expectedFile] === srcSha ? "yes" : "no";
    console.log(
      "| " +
        [
          r.id.slice(-8),
          r.orgId.slice(-8),
          r.name,
          r.modalidade ?? "-",
          r.version,
          r.isDefault ? "✓" : "",
          r.status,
          r.engine,
          srcSha,
          matches,
          r._count.contracts,
          r.updatedAt.toISOString().slice(0, 10),
        ].join(" | ") +
        " |"
    );
  }
  console.log();

  const orphans = rows.filter(
    (r) => r.version === "1.0.0" || r.name === "Compra e Venda de Imovel"
  );
  if (orphans.length > 0) {
    console.log(`Legacy candidates (v1.0.0 or "Compra e Venda de Imovel"):`);
    for (const o of orphans) {
      const action = o._count.contracts > 0 ? "archive" : "delete";
      console.log(
        `  ${o.id} — ${o.name} — ${o._count.contracts} contracts → recommend: ${action}`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("[audit-templates] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
