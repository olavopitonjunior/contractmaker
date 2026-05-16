/**
 * Diagnóstico: lista permissions de um Google Doc específico pra validar que
 * o backfill-anyone-permission aplicou.
 *
 * Uso:
 *   npx tsx apps/web/scripts/diag-anyone-permission.ts --docId=<drive-doc-id>
 *   npx tsx apps/web/scripts/diag-anyone-permission.ts --contractId=<contract-id>
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

import { prisma } from "../src/lib/db/prisma";
import { getOwnerDriveClient } from "../src/lib/google/client";

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  let docId = arg("docId");
  const contractId = arg("contractId");
  if (!docId && contractId) {
    const c = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { googleDocId: true, status: true, version: true },
    });
    if (!c?.googleDocId) {
      console.error(`Contrato ${contractId} sem googleDocId`);
      process.exit(1);
    }
    docId = c.googleDocId;
    console.log(`Contrato ${contractId} v${c.version} (${c.status}) → docId ${docId}`);
  }
  if (!docId) {
    console.error("Passe --docId=<id> ou --contractId=<id>");
    process.exit(1);
  }

  const drive = getOwnerDriveClient();
  const res = await drive.permissions.list({
    fileId: docId,
    fields: "permissions(id, type, role, emailAddress, allowFileDiscovery)",
    supportsAllDrives: true,
  });

  console.log(`\nPermissions em ${docId}:`);
  for (const p of res.data.permissions || []) {
    const target =
      p.type === "anyone"
        ? `anyone (discovery=${p.allowFileDiscovery ?? "—"})`
        : `${p.type} ${p.emailAddress ?? ""}`.trim();
    console.log(`  · ${p.role} — ${target}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
